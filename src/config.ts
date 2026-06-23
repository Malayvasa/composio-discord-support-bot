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
  SUPPORT_FORUM_AUTHOR_IDS: z.string().optional(),
  DEFAULT_STAFF_USER_IDS: z.string().optional(),
  AUTH_STAFF_USER_IDS: z.string().optional(),
  BILLING_STAFF_USER_IDS: z.string().optional(),
  INFRA_STAFF_USER_IDS: z.string().optional(),
  DIAGNOSTICS_STAFF_USER_IDS: z.string().optional(),
  PRIVATE_DIAGNOSTICS_CHANNEL_ID: z.string().optional(),
  PRIVATE_THREAD_NAME_PREFIX: z.string().default("support-debug"),
  COMPOSIO_TOOLKITS: z
    .string()
    .default("github,linear,slack,gmail,datadog,metabase"),
  COMPOSIO_WORKBENCH_ENABLED: z
    .enum(["true", "false"])
    .default("false"),
  DISCORD_CONTEXT_LIMIT: z.coerce.number().int().min(1).max(50).default(12),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(25).default(10),
  ATTACHMENT_MAX_FILES: z.coerce.number().int().min(1).max(10).default(5),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().min(1).default(1_000_000),
  ATTACHMENT_TEXT_MAX_CHARS: z.coerce
    .number()
    .int()
    .min(1)
    .default(12_000),
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
  supportForumAuthorIds: csv(env.SUPPORT_FORUM_AUTHOR_IDS),
  defaultStaffUserIds: csv(env.DEFAULT_STAFF_USER_IDS),
  authStaffUserIds: csv(env.AUTH_STAFF_USER_IDS),
  billingStaffUserIds: csv(env.BILLING_STAFF_USER_IDS),
  infraStaffUserIds: csv(env.INFRA_STAFF_USER_IDS),
  diagnosticsStaffUserIds: csv(env.DIAGNOSTICS_STAFF_USER_IDS),
  privateDiagnosticsChannelId: env.PRIVATE_DIAGNOSTICS_CHANNEL_ID,
  privateThreadNamePrefix: env.PRIVATE_THREAD_NAME_PREFIX,
  composioToolkits: csv(env.COMPOSIO_TOOLKITS),
  composioWorkbenchEnabled: env.COMPOSIO_WORKBENCH_ENABLED === "true",
  discordContextLimit: env.DISCORD_CONTEXT_LIMIT,
  maxAgentSteps: env.MAX_AGENT_STEPS,
  attachmentMaxFiles: env.ATTACHMENT_MAX_FILES,
  attachmentMaxBytes: env.ATTACHMENT_MAX_BYTES,
  attachmentTextMaxChars: env.ATTACHMENT_TEXT_MAX_CHARS,
};
