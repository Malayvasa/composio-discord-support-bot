import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { config } from "../config.js";
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
  tools: ToolSet;
}

const buildSystemPrompt = async () => {
  const runbooks = await getRunbooks();

  return `You are a senior customer support engineer for Composio, embedded in Discord.

Your job:
- Triage customer issues clearly and kindly.
- Use the provided runbooks before using tools.
- Use Composio tools only when they help answer or diagnose the issue.
- Preserve evidence: environment, toolkit, tool slug, user ID, session ID, connected account ID, request ID, trace ID, status code, timestamp, and Discord message URL.
- Ask for missing identifiers before doing broad diagnostics.
- Do not expose secrets, credentials, tokens, raw unrelated logs, or private customer data.
- Customers do not connect internal tools. Internal tools are connected to the configured support-team Composio session.
- If diagnostics tools are unavailable or unconnected, say so and continue with runbook-based guidance.
- Escalate production 5xxs, security/billing issues, data integrity concerns, and repeated incidents.

When responding:
- Be concise.
- Start with the likely issue or next step.
- If you used tools, summarize what you checked.
- If you need more information, ask for at most three specific items.
- If escalating, include an evidence bundle that a teammate can act on.

Runbooks:
${runbooks}`;
};

export const runSupportAgent = async ({
  customerMessage,
  discordContext,
  discordMessageUrl,
  tools,
}: SupportTurnInput) => {
  const system = await buildSystemPrompt();

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        "Customer support request from Discord.",
        "",
        `Discord message URL: ${discordMessageUrl}`,
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
    tools,
    stopWhen: stepCountIs(config.maxAgentSteps),
  });

  return result.text.trim();
};

