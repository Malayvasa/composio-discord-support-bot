import type { Message, TextBasedChannel } from "discord.js";
import { config } from "../config.js";
import {
  collectSupportAttachments,
  formatAttachmentMetadata,
} from "../support/attachments.js";
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

const truncateForPrivateContext = (value: string, maxLength = 1200) =>
  value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength).trim()}\n[truncated]`;

export const buildPrivateCaseContext = ({
  message,
  customerMessage,
  decision,
  debugFields,
  attachments,
}: {
  message: Message;
  customerMessage: string;
  decision: ReturnType<typeof classifyPrivacy>;
  debugFields: ReturnType<typeof parseDebugFields>;
  attachments: Awaited<ReturnType<typeof collectSupportAttachments>>;
}) =>
  [
    getChannelName(message)
      ? `Discord channel/thread name: ${getChannelName(message)}`
      : "",
    `Public message: ${message.url}`,
    `Route: ${decision.route}`,
    decision.reasons.length
      ? `Why private: ${decision.reasons.join(", ")}`
      : "",
    "",
    "Triggering customer report:",
    truncateForPrivateContext(customerMessage || "[attachment-only support request]"),
    "",
    "Parsed debug fields:",
    formatDebugFields(debugFields),
    "",
    "Attachments:",
    attachments.length > 0
      ? formatAttachmentMetadata(attachments)
      : "No attachments provided.",
  ]
    .filter(Boolean)
    .join("\n");
