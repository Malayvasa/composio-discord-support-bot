import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { config } from "../config.js";
import {
  formatAttachmentsForAgent,
  type SupportAttachment,
} from "./attachments.js";
import { formatDebugFields, type DebugFields } from "./debug-fields.js";
import { loadRunbooks } from "./runbooks.js";

let runbookCache: Promise<string> | undefined;

const getRunbooks = () => {
  runbookCache ??= loadRunbooks();
  return runbookCache;
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
  const runbooks = await getRunbooks();
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
- Give safe runbook-based guidance or ask for non-secret clarifying details.`;

  return `You are a senior customer support engineer for Composio, embedded in Discord.

Your job:
- Triage customer issues clearly and kindly.
- Use the provided runbooks before using tools.
- For product-specific support requests about Composio behavior, SDKs, CLI, MCP, OAuth, toolkits, auth configs, scopes, or provider setup, search official docs before answering unless the message is clearly social/off-topic or only requires private diagnostics.
- Use Composio tools for docs lookup: first call COMPOSIO_SEARCH_TOOLS for "search documentation website" with known fields like "domain: docs.composio.dev", then use COMPOSIO_MULTI_EXECUTE_TOOL for the returned composio_search tools such as web search or URL fetch.
- Keep docs lookup scoped to official Composio documentation, especially docs.composio.dev and https://docs.composio.dev/llms.txt.
- Prefer official Composio docs over memory. Cite the docs URL when a tool result provides one.
- Use Composio tools only in private mode and only when they help answer or diagnose the issue.
- Public mode may use only public documentation/search tools. Public mode must not use Datadog, Metabase, logs, dashboards, account lookups, or private customer data.
- Check for known-incident or platform-wide signals before giving local setup troubleshooting.
- Classify MCP/auth/API-key issues by product surface, client, auth mode, credential type, endpoint, and status code before suggesting fixes.
- Preserve evidence: environment, toolkit, tool slug, user ID, session ID, connected account ID, request ID, trace ID, status code, timestamp, and Discord message URL.
- Ask for missing identifiers before doing broad diagnostics.
- Do not expose secrets, credentials, tokens, raw unrelated logs, or private customer data.
- Customers do not connect internal tools. Internal tools are connected to the configured support-team Composio session.
- Treat @toolkit as the customer-reported failing toolkit, not as a list of tools this support bot must have enabled.
- Use Datadog and Metabase as internal observability for Composio tool executions, connected-account state, traces, and operational history, including issues involving customer toolkits such as GitHub, Gmail, Slack, or Linear.
- If diagnostics tools are unavailable or unconnected, say so and continue with runbook-based guidance.
- If docs search/fetch tools are unavailable, say the answer is based on loaded runbooks and ask staff to verify docs when the detail is product-specific.
- Do not claim "I will escalate" unless a tool or workflow actually created an escalation. If escalation is needed but not created, say "this needs staff action" and provide an evidence bundle.
- Treat @debug fields as optional clues, not a required form. Use whatever is present.
- If more information would materially improve the next diagnostic step, ask for the smallest useful clue and say where to find it.
- If the post is off-topic, hiring, promotional, or social rather than a support request, do not troubleshoot. Reply only with a brief redirect if an explicit reply is required.

Mode:
${modeInstructions}

When responding:
- Be concise. Public replies should usually be 2-5 lines. Private diagnostics should use short sections only when useful.
- Start with the likely issue or next step.
- If you used tools, summarize what you checked.
- If you need more information, ask for one specific detail in plain staff language, for example "Please ask the customer for the exact owner/repo." Never write planning labels like "ask customer for 1 item."
- If staff action is needed, include an evidence bundle that a teammate can act on without promising that you created an escalation.
- Do not paste long raw logs or file contents back into Discord. Summarize the relevant signal and cite the attachment name.
- Do not expose raw tool-call, schema, or parameter errors unless the operator must act on that exact error. Prefer "I could not confirm this in internal logs yet" over raw diagnostics-tool failure text.

Runbooks:
${runbooks}`;
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
  const system = await buildSystemPrompt(mode);

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
    stopWhen: stepCountIs(config.maxAgentSteps),
  });

  return polishSupportAnswer(result.text, mode);
};
