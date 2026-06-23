import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { config } from "../config.js";
import {
  formatAttachmentsForAgent,
  type SupportAttachment,
} from "./attachments.js";
import { fetchComposioToolLogSummaries } from "./composio-logs.js";
import { formatDebugFields, type DebugFields } from "./debug-fields.js";
import { loadKnowledge } from "./knowledge.js";

let knowledgeCache: Promise<string> | undefined;

const getKnowledge = () => {
  knowledgeCache ??= loadKnowledge();
  return knowledgeCache;
};

const polishSupportAnswer = (answer: string, mode: "public" | "private") => {
  let polished = answer.trim();

  if (mode === "private") {
    polished = polished
      .replace(/\s*\((?:ask|ask the) customer for\s+1\s+item\)/gi, "")
      .replace(/\b(?:ask|ask the) customer for\s+1\s+item\b/gi, "missing detail")
      .replace(/\bAsk them for the\b/g, "Please ask the customer for the")
      .replace(
        /\benable the ([a-z0-9_-]+) toolkit for connected-account-level debugging\b/gi,
        "use Datadog or Metabase to inspect the Composio tool execution and connected-account state"
      )
      .replace(
        /\benable the ([a-z0-9_-]+) toolkit for deeper tool diagnostics\b/gi,
        "use Datadog or Metabase to inspect the Composio tool execution and connected-account state"
      )
      .replace(/^#{1,3}\s*Likely root causes to validate\s*$/gim, "### Likely cause")
      .replace(/^#{1,3}\s*Staff action \/ next diagnostic step\s*$/gim, "### Next step")
      .replace(/^#{1,3}\s*Evidence bundle\s*$/gim, "### Evidence");
  }

  return polished.trim();
};

const rewritePrivateStaffNote = async (answer: string, model?: string) => {
  const result = await generateText({
    model: openai(model ?? config.openaiModel),
    system: [
      "Rewrite the draft as a concise customer-facing support update for a private Discord support thread.",
      "Preserve only facts present in the draft. Do not invent checks or outcomes.",
      "Maximum 850 characters.",
      "Use friendly support language, not internal investigation labels.",
      "Use 3-4 short sentences, not headings.",
      "Acknowledge what context we have.",
      "Explain the likely issue in customer-safe terms.",
      "Ask for one specific next detail and say where to find it.",
      "Say what we will check after receiving it.",
      "Do not include markdown headings, numbered lists, docs link lists, or raw tool/schema/parameter errors.",
      "Do not say 'ask customer for 1 item', 'unblocks everything', or other planning labels.",
      "If the draft asks for multiple customer details, keep only the most important one.",
      "Avoid phrases like 'Datadog query', 'Metabase query', 'internal logs', or raw IDs unless they were supplied by the user and are necessary.",
      "If request IDs are already present, do not ask for more customer details unless the draft says the request-ID lookup was inconclusive or unavailable.",
      "A reported @toolkit value is the customer's failing toolkit. Do not tell staff to enable that provider toolkit for debugging.",
      "Datadog and Metabase are internal Composio observability tools for checking Composio-side execution and account state.",
    ].join("\n"),
    prompt: answer,
    maxOutputTokens: 260,
  });

  return polishSupportAnswer(result.text, "private");
};

const rewritePublicSupportAnswer = async (answer: string, model?: string) => {
  const result = await generateText({
    model: openai(model ?? config.openaiModel),
    system: [
      "Rewrite the draft as a complete, concise public Discord support reply.",
      "Preserve only facts present in the draft. Do not invent checks or outcomes.",
      "Maximum 550 characters.",
      "Use 2-4 short sentences.",
      "No headings, numbered lists, bullets, or long checklists.",
      "Give the likely cause, one concrete next step, and at most one follow-up detail.",
      "Do not mention private diagnostics, Datadog, Metabase, logs, or internal tools.",
      "Do not end mid-sentence. If needed, drop less important details to keep the answer complete.",
    ].join("\n"),
    prompt: answer,
    maxOutputTokens: 180,
  });

  return polishSupportAnswer(result.text, "public");
};

const hasActionableDiagnosticSignal = (fields: DebugFields) =>
  Boolean(
    fields.request_id ||
      fields.log_id ||
      fields.trace_id ||
      fields.connected_account_id ||
      fields.session_id ||
      (fields.tool && fields.error && fields.time_window)
  );

const buildInsufficientSignalPrivateReply = (
  fields: DebugFields,
  customerMessage = ""
) => {
  const hasToolContext = Boolean(fields.toolkit || fields.tool || fields.error);
  const isOrgApiAuth =
    /\b(x-org-api-key|org api key|organization api key|\/org\/owner\/project|regenerate_api_key|project api key)\b/i.test(
      customerMessage
    );
  const context = [
    fields.project_id ? `project ${fields.project_id}` : "",
    fields.org_id ? `org ${fields.org_id}` : "",
    fields.user_id ? `user ${fields.user_id}` : "",
    fields.toolkit ? `${fields.toolkit} toolkit` : "",
    fields.tool ? fields.tool : "",
  ]
    .filter(Boolean)
    .join(", ");
  const likelyIssue = hasToolContext
    ? "A 403 here usually means the connected provider account can authenticate, but the provider is denying access to the specific resource or action."
    : isOrgApiAuth
      ? "Because the same org API key can fetch the project but gets 403 on project-key regeneration, this looks like endpoint-level authorization or permission enforcement rather than a bad key."
    : "The account identifiers are helpful, but they do not point to a single failed execution yet.";
  const requestIdAsk = isOrgApiAuth
    ? "Please share the real request ID or response headers from the failed POST; it is usually in the response body, response headers, or server log for that request."
    : "Please share the request ID from one failed tool execution; it is usually in the SDK error output, dashboard run log, or the server log line for that failed call.";
  const followup = isOrgApiAuth
    ? "Once we have that request ID, we can check the exact API gateway/backend denial and confirm whether the endpoint expects a different permission or is currently blocked."
    : "Once we have that request ID, we can check the exact Composio execution, connected-account state, and sanitized provider error.";

  return [
    context ? `I have the context for ${context}.` : "I have the account context from the report.",
    likelyIssue,
    requestIdAsk,
    followup,
  ].join("\n");
};

export interface SupportTurnInput {
  customerMessage: string;
  discordContext: string;
  discordMessageUrl: string;
  mode: "public" | "private";
  tools?: ToolSet;
  composioSessionId?: string;
  composioUserId?: string;
  debugFields?: DebugFields;
  attachments?: SupportAttachment[];
  model?: string;
}

const buildSystemPrompt = async (mode: "public" | "private") => {
  const knowledge = await getKnowledge();
  const modeInstructions =
    mode === "private"
      ? `You are in a private staff-only diagnostics thread.
- You may use Composio tools when they help diagnose the issue.
- Datadog and Metabase are internal Composio observability tools for checking customer-facing Composio failures across any reported toolkit.
- A debug field like @toolkit: github means the customer's Composio app was calling the GitHub toolkit. It does not mean this support bot needs the GitHub toolkit enabled to investigate.
- Do not tell staff to enable the reported customer toolkit for debugging unless the task explicitly requires the support bot to perform provider actions itself.
- Still summarize findings safely and avoid secrets, raw tokens, unrelated customer data, and broad data dumps.`
      : `You are in a public customer-visible Discord surface.
- Do not use internal diagnostics or private customer/account/log data.
- Do not claim that you checked Datadog, Metabase, logs, dashboards, or internal systems.
- If private diagnostics are needed, say that staff will investigate in a private thread.
- Give safe knowledge-based guidance or ask for non-secret clarifying details.`;

  return `You are a senior customer support engineer for Composio, embedded in Discord.

Your job:
- Triage customer issues clearly and kindly, and classify before you troubleshoot.
- Use the provided knowledge before using tools.
- For product questions about Composio behavior, SDKs, CLI, MCP, OAuth, toolkits, auth configs, scopes, triggers, or provider setup, search official docs before answering unless the message is clearly social/off-topic or only requires private diagnostics.
- Use Composio tools for docs lookup: first call COMPOSIO_SEARCH_TOOLS for "search documentation website" with known fields like "domain: docs.composio.dev", then use COMPOSIO_MULTI_EXECUTE_TOOL for the returned composio_search tools such as web search or URL fetch.
- Keep docs lookup scoped to official Composio documentation, especially docs.composio.dev and https://docs.composio.dev/llms.txt. Prefer official docs over memory, and cite the docs URL when a tool result provides one.
- Use Composio tools only in private mode and only when they help answer or diagnose. Public mode may use only public documentation/search tools, never Datadog, Metabase, logs, dashboards, account lookups, or private customer data.

Composio mental model (use the current terminology; classify every issue against it):
- A session is the server-side runtime context for one user: it ties together the User ID (whose connected accounts and executions are in scope), tool access, authentication, and execution state. Sessions persist and do not expire; reuse the session ID via composio.use() instead of calling create() again.
- A toolkit is a service (slug is lowercase, e.g. github, gmail, slack). A tool is one action, slug {TOOLKIT}_{ACTION} (e.g. GITHUB_CREATE_ISSUE).
- A connected account (ca_…) stores one user's credentials for a toolkit; a user can have several per toolkit. An auth config is the blueprint for how a toolkit authenticates (OAUTH2, API_KEY, BEARER_TOKEN, BASIC). A project (proj_…) isolates API keys, connected accounts, auth configs, and webhooks; the project-scoped API key is distinct from the org-level x-org-api-key.
- Execution surfaces differ and the fix differs with them: Sessions expose the meta tools (COMPOSIO_SEARCH_TOOLS, COMPOSIO_GET_TOOL_SCHEMAS, COMPOSIO_MANAGE_CONNECTIONS, COMPOSIO_MULTI_EXECUTE_TOOL, COMPOSIO_REMOTE_WORKBENCH, COMPOSIO_REMOTE_BASH_TOOL) for runtime discovery, in-chat auth, and the workbench. Direct execution loads tool schemas upfront and the developer owns auth and state. MCP serves tools over session.mcp.url to any MCP client. Proxy execute makes an authenticated HTTP call through a connected account and bypasses session state, schemas, and modifiers. (Note: the experimental "Tool Router" beta has graduated to sessions — it is the same feature under the current name, not a separate surface.) Single-toolkit MCP (composio.mcp.create()) is deprecated — point users to sessions.
- Auth mode: Composio managed auth (the default; users see "Composio wants to access your account") versus a custom auth config (the developer's own OAuth app or non-OAuth credentials). White-labeling the OAuth consent screen and removing "Secured by Composio" requires a custom auth config, not just Connect Link branding. Custom OAuth requires the redirect URI https://backend.composio.dev/api/v3.1/toolkits/auth/callback registered in the provider portal.
- Composio auto-refreshes OAuth tokens. Status EXPIRED means the user revoked access or refresh failed permanently; INACTIVE accounts cannot execute. Re-authentication is the fix, not a code change.
- Migration: connectedAccounts.initiate() for Composio-managed OAuth is deprecated in favor of link() (cutover 2026-05-08 new orgs, 2026-07-03 all orgs; calling it after retires raises ComposioLegacyConnectedAccountsEndpointRetiredError). initiate() stays valid for custom auth configs and non-OAuth schemes. Route by the is_composio_managed / isComposioManaged flag.

Triage order before suggesting a fix:
1. Check for a known-incident or platform-wide signal before assuming local setup.
2. Identify the surface (session/meta tools, direct execution, MCP, or proxy execute), the client, the auth mode (managed vs custom), the credential type, the endpoint, and the status code.
3. Decide whether the cause is Composio-side, provider-side, or user-config, and name the evidence that distinguishes them.
4. Preserve evidence: environment, toolkit, tool slug, user ID, session ID, connected account ID (ca_), auth config ID, request ID, trace ID, log ID, status code, timestamp, and the Discord message URL.

Composio-side vs provider-side vs user-config (don't blame the platform without evidence):
- Tool 401/403 is usually provider-side or user-config: missing OAuth scopes, or the connected account lacks the permission/plan the action needs — fix is re-auth with the right scopes or an account upgrade, not a Composio bug.
- Managed auth cannot request scopes that aren't pre-approved in Composio's OAuth app; adding them fails by design — use only managed scopes or move to a custom auth config.
- Fewer tools from the API than the dashboard means toolkit_versions=latest was not passed (the API defaults to base 00000000_00). Sessions with meta tools always use the latest version; pinning applies only to direct execution.
- MCP 401 = missing x-api-key header (required when require_mcp_api_key is on; it defaults on for orgs created on/after 2026-03-05). MCP "connected account not found" = no account specified (defaults to user_id=default), a non-ACTIVE account, or an account bound to a different auth config than the MCP server.
- Credentials shown as masked/REDACTED is the "Mask Connected Account Secrets" project setting, not data loss.
- Proxy execute rejecting a cross-domain call is an intentional security boundary; a manual Authorization header overrides Composio's injected credential and typically causes 401.
- Trigger delivery failures: polling under 15 minutes is unsupported on managed auth, the webhook URL must be public and return 2xx, or the trigger is disabled.
- Never use 'default' as a production user ID — it exposes other users' data.

Operating guardrails:
- Use Composio tools only in private mode, and only when they help answer or diagnose.
- Customers do not connect internal tools; internal tools are connected to the configured support-team Composio session.
- Treat @toolkit as the customer's failing toolkit, not a toolkit this support bot must have enabled.
- Use Datadog and Metabase as internal observability for Composio tool executions, connected-account state, traces, and operational history, including for customer toolkits such as GitHub, Gmail, Slack, or Linear.
- If diagnostics tools are unavailable or unconnected, say so and continue with knowledge-based guidance. If docs search/fetch is unavailable, say the answer is based on loaded knowledge and ask staff to verify docs for product-specific details.
- Do not expose secrets, credentials, tokens, raw unrelated logs, or private customer data.
- Treat @debug fields as optional clues, not a required form; use whatever is present.
- If request IDs (x-request-id) are present, use them as the primary clue. If Composio log IDs (log_…) are present, use the provided fetched log summary as primary evidence. Do not ask the customer for payload JSON, screenshots, or another identifier, or tell them to run the Logs API/CLI, before checking the exact execution or saying the lookup is unavailable.
- Treat exact request-ID, trace-ID, session-ID, log-ID, or connected-account lookups as stronger evidence than broad error or slug searches. If an exact lookup finds nothing but a broad search finds related events, say plainly those are related pattern evidence only and do not imply the supplied execution was confirmed.
- Do not claim a spike, trend, outage, or "multiple toolkits/customers" unless tool results show explicit counts or multiple matching events; include the count or call it a broad match.
- Do not claim "I will escalate" unless a tool or workflow actually created an escalation. If escalation is needed but not created, say "this needs staff action" and provide an evidence bundle.
- If the post is off-topic, hiring, promotional, or social rather than support, do not troubleshoot; reply only with a brief redirect if a reply is required.

Mode:
${modeInstructions}

When responding:
- Be concise. Public replies should usually be 2-4 short lines and under 700 characters unless a safety-critical answer needs more. Private diagnostics should still read like a customer-facing support update, not an internal log note.
- Start with the likely issue or next step, named in current Composio terms (surface, auth mode, status code) rather than vague restating.
- If you used tools, summarize what you checked.
- If you need more information, ask for one specific detail in plain support language and say where to find it, for example "Please share the request ID from one failed tool execution; it's usually in the SDK error output or the dashboard run log." Never write planning labels like "ask customer for 1 item." For deeper Composio-side checks, the useful identifiers are project_id (pr_/proj_), org_id (ok_), the connected account ID, and a request or log ID.
- In public mode, do not include long checklists. Give the likely cause, one concrete check/fix, and at most one follow-up detail to share.
- If staff action is needed, include an evidence bundle a teammate can act on, without promising you created an escalation. In public mode, keep this to one sentence.
- Do not paste long raw logs or file contents into Discord; summarize the relevant signal and cite the attachment name.
- Do not expose raw tool-call, schema, or parameter errors unless the operator must act on that exact error. Prefer "I could not confirm this in internal logs yet" over raw diagnostics-tool failure text.

Knowledge:
${knowledge}`;
};

export const runSupportAgent = async ({
  customerMessage,
  discordContext,
  discordMessageUrl,
  mode,
  tools,
  composioSessionId,
  composioUserId,
  debugFields,
  attachments = [],
  model,
}: SupportTurnInput) => {
  if (mode === "private" && !hasActionableDiagnosticSignal(debugFields ?? {})) {
    return buildInsufficientSignalPrivateReply(debugFields ?? {}, customerMessage);
  }

  const system = await buildSystemPrompt(mode);
  const toolLogSummary =
    mode === "private" && debugFields?.log_id
      ? await fetchComposioToolLogSummaries(debugFields.log_id)
      : "No Composio tool log ID lookup was requested.";

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        "Customer support request from Discord.",
        "",
        `Discord message URL: ${discordMessageUrl}`,
        composioUserId ? `Composio support user ID: ${composioUserId}` : "",
        composioSessionId ? `Composio support session ID: ${composioSessionId}` : "",
        "",
        "Parsed optional @debug fields:",
        formatDebugFields(debugFields ?? {}),
        "",
        "Discord attachments:",
        formatAttachmentsForAgent(attachments),
        "",
        "Fetched Composio tool log evidence:",
        toolLogSummary,
        "",
        "Recent Discord context:",
        discordContext,
        "",
        "Latest customer message:",
        customerMessage,
      ].join("\n"),
    },
  ];

  const result = await generateText({
    model: openai(model ?? config.openaiModel),
    system,
    messages,
    ...(tools ? { tools } : {}),
    maxOutputTokens: mode === "private" ? 900 : 650,
    stopWhen: stepCountIs(config.maxAgentSteps),
  });

  const polished = polishSupportAnswer(result.text, mode);

  if (mode === "private") {
    return rewritePrivateStaffNote(polished, model);
  }

  return rewritePublicSupportAnswer(polished, model);
};
