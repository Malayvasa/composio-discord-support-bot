import "dotenv/config";
import { z } from "zod";

const csv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  COMPOSIO_API_KEY: z.string().min(1, "COMPOSIO_API_KEY is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-5.2"),
  PORT: z.coerce.number().int().positive().default(5432),
  SUPPORT_SESSION_USER_ID: z.string().default("support-team"),
  SUPPORT_CHANNEL_IDS: z.string().optional(),
  COMPOSIO_TOOLKITS: z
    .string()
    .default("github,linear,slack,gmail,datadog,metabase"),
  COMPOSIO_WORKBENCH_ENABLED: z
    .enum(["true", "false"])
    .default("false"),
  DISCORD_CONTEXT_LIMIT: z.coerce.number().int().min(1).max(50).default(12),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(25).default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

export const config = {
  discordToken: env.DISCORD_TOKEN,
  composioApiKey: env.COMPOSIO_API_KEY,
  openaiModel: env.OPENAI_MODEL,
  port: env.PORT,
  supportSessionUserId: env.SUPPORT_SESSION_USER_ID,
  supportChannelIds: csv(env.SUPPORT_CHANNEL_IDS),
  composioToolkits: csv(env.COMPOSIO_TOOLKITS),
  composioWorkbenchEnabled: env.COMPOSIO_WORKBENCH_ENABLED === "true",
  discordContextLimit: env.DISCORD_CONTEXT_LIMIT,
  maxAgentSteps: env.MAX_AGENT_STEPS,
};

