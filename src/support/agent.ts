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
}

const buildSystemPrompt = async (mode: "public" | "private") => {
  const runbooks = await getRunbooks();
  const modeInstructions =
    mode === "private"
      ? `You are in a private staff-only diagnostics thread.
- You may use Composio tools when they help diagnose the issue.
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
- Use Composio tools only in private mode and only when they help answer or diagnose the issue.
- Preserve evidence: environment, toolkit, tool slug, user ID, session ID, connected account ID, request ID, trace ID, status code, timestamp, and Discord message URL.
- Ask for missing identifiers before doing broad diagnostics.
- Do not expose secrets, credentials, tokens, raw unrelated logs, or private customer data.
- Customers do not connect internal tools. Internal tools are connected to the configured support-team Composio session.
- If diagnostics tools are unavailable or unconnected, say so and continue with runbook-based guidance.
- Escalate production 5xxs, security/billing issues, data integrity concerns, and repeated incidents.
- Treat @debug fields as optional clues, not a required form. Use whatever is present.
- If more information would materially improve the next diagnostic step, ask for the smallest useful clue and say where to find it.

Mode:
${modeInstructions}

When responding:
- Be concise. Public replies should usually be 2-5 lines. Private diagnostics should use short sections only when useful.
- Start with the likely issue or next step.
- If you used tools, summarize what you checked.
- If you need more information, ask for one specific item unless several are truly blocking.
- If escalating, include an evidence bundle that a teammate can act on.
- Do not paste long raw logs or file contents back into Discord. Summarize the relevant signal and cite the attachment name.

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
    model: openai(config.openaiModel),
    system,
    messages,
    ...(mode === "private" && tools ? { tools } : {}),
    stopWhen: stepCountIs(config.maxAgentSteps),
  });

  return result.text.trim();
};
