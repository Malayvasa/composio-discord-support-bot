import type { Message, TextBasedChannel } from "discord.js";
import { config } from "../config.js";
import { collectSupportAttachments } from "../support/attachments.js";
import { formatDebugFields, parseDebugFields } from "../support/debug-fields.js";
import { classifyPrivacy } from "../support/privacy.js";
import {
  formatMessageForContext,
  isFetchableMessageChannel,
} from "../utils/discord.js";
import { getChannelName } from "./message-routing.js";

const getDiscordContext = async (
  channel: TextBasedChannel,
  fallback: Message
) => {
  if (!isFetchableMessageChannel(channel)) {
    return formatMessageForContext(fallback);
  }

  const fetched = await channel.messages.fetch({
    limit: config.discordContextLimit,
  });

  if (!(fetched instanceof Map)) {
    return formatMessageForContext(fallback);
  }

  return Array.from(fetched.values())
    .reverse()
    .map(formatMessageForContext)
    .join("\n");
};

export const buildDiscordContext = async (
  channel: TextBasedChannel,
  message: Message
) => {
  const channelName = getChannelName(message);
  const context = await getDiscordContext(channel, message);

  return [
    channelName ? `Discord channel/thread name: ${channelName}` : "",
    context,
  ]
    .filter(Boolean)
    .join("\n");
};

const markdownFenceFor = (value: string) => {
  const longestBacktickRun = Math.max(
    2,
    ...Array.from(value.matchAll(/`+/g)).map((match) => match[0].length)
  );

  return "`".repeat(longestBacktickRun + 1);
};

const formatExactCustomerQuote = (message: Message) => {
  const content = message.content;

  if (!content) {
    return "```txt\n[attachment-only support request]\n```";
  }

  const fence = markdownFenceFor(content);
  return `${fence}txt\n${content}\n${fence}`;
};

const formatPrivateDebugFields = (
  debugFields: ReturnType<typeof parseDebugFields>
) => {
  const formatted = formatDebugFields(debugFields);
  return formatted === "No debug fields provided."
    ? "- None provided yet."
    : formatted
        .split("\n")
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
};

const formatPrivateAttachments = (
  attachments: Awaited<ReturnType<typeof collectSupportAttachments>>
) => {
  if (attachments.length === 0) {
    return "- None.";
  }

  return attachments
    .map((attachment, index) =>
      [
        `- ${index + 1}. ${attachment.name}`,
        `  - Type: ${attachment.contentType ?? "unknown"}`,
        `  - Size: ${attachment.size} bytes`,
        `  - Text: ${attachment.textStatus}`,
        `  - URL: ${attachment.url}`,
      ].join("\n")
    )
    .join("\n");
};

export const buildPrivateCaseContext = ({
  message,
  decision,
  debugFields,
  attachments,
}: {
  message: Message;
  decision: ReturnType<typeof classifyPrivacy>;
  debugFields: ReturnType<typeof parseDebugFields>;
  attachments: Awaited<ReturnType<typeof collectSupportAttachments>>;
}) =>
  [
    "**Case summary**",
    "",
    `**Route:** ${decision.route}`,
    `**Why private:** ${
      decision.reasons.length ? decision.reasons.join(", ") : "staff diagnostics"
    }`,
    getChannelName(message)
      ? `**Source:** #${getChannelName(message)} - ${message.url}`
      : `**Source:** ${message.url}`,
    "",
    "**Original customer message**",
    formatExactCustomerQuote(message),
    "",
    "**Debug fields**",
    formatPrivateDebugFields(debugFields),
    "",
    "**Attachments**",
    formatPrivateAttachments(attachments),
    "",
    "**Next step**",
    "- I will check the available support tools and reply with a customer-safe update.",
  ]
    .filter(Boolean)
    .join("\n");
