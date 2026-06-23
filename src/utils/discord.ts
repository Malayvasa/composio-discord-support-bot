import type { Message, MessageCreateOptions, TextBasedChannel } from "discord.js";

export type SendableChannel = TextBasedChannel & {
  send: (options: string | MessageCreateOptions) => Promise<Message>;
  sendTyping?: () => Promise<void>;
};

export const isSendableChannel = (
  channel: TextBasedChannel
): channel is SendableChannel => "send" in channel;

export const isFetchableMessageChannel = (
  channel: TextBasedChannel
): channel is TextBasedChannel & {
  messages: { fetch: (options: { limit: number }) => Promise<unknown> };
} => "messages" in channel;

export const splitDiscordMessage = (text: string, maxLength = 1900) => {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const cutAt = Math.max(
      remaining.lastIndexOf("\n", maxLength),
      remaining.lastIndexOf(" ", maxLength)
    );
    const index = cutAt > 0 ? cutAt : maxLength;
    chunks.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
};

export const formatMessageForContext = (message: Message) => {
  const author = message.author.bot
    ? `${message.author.username} (bot)`
    : message.author.username;
  const timestamp = message.createdAt.toISOString();
  const content = message.content || "[no text content]";
  const attachments = Array.from(message.attachments.values());
  const attachmentContext =
    attachments.length > 0
      ? ` [attachments: ${attachments
          .map((attachment) => {
            const type = attachment.contentType ?? "unknown";
            return `${attachment.name} (${type}, ${attachment.size} bytes)`;
          })
          .join("; ")}]`
      : "";

  return `[${timestamp}] ${author}: ${content}${attachmentContext}`;
};
