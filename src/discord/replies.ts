import { MessageFlags, type Message, type TextBasedChannel } from "discord.js";
import {
  isSendableChannel,
  splitDiscordMessage,
} from "../utils/discord.js";

export const sendLongReply = async (message: Message, text: string) => {
  const channel = message.channel;

  if (!isSendableChannel(channel)) {
    return;
  }

  const chunks = splitDiscordMessage(text);
  await message.reply({
    content: chunks.shift() ?? "I could not produce a response.",
    allowedMentions: { repliedUser: false },
    flags: MessageFlags.SuppressEmbeds,
  });

  for (const chunk of chunks) {
    await channel.send({
      content: chunk,
      allowedMentions: { users: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  }
};

export const editReplyWithLongMessage = async ({
  reply,
  channel,
  text,
  firstMessageSuffix,
  allowedUserMentions = [],
}: {
  reply: Message;
  channel: TextBasedChannel;
  text: string;
  firstMessageSuffix?: string;
  allowedUserMentions?: string[];
}) => {
  if (!isSendableChannel(channel)) {
    return;
  }

  const chunks = splitDiscordMessage(text);
  const firstChunk = chunks.shift() ?? "I could not produce a response.";

  await reply.edit({
    content: firstMessageSuffix
      ? `${firstChunk}\n\n${firstMessageSuffix}`
      : firstChunk,
    allowedMentions: { users: allowedUserMentions },
    flags: MessageFlags.SuppressEmbeds,
  });

  for (const chunk of chunks) {
    await channel.send({
      content: chunk,
      allowedMentions: { users: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  }
};

export const withProgressUpdates = async <T>({
  message,
  states,
  task,
  intervalMs = 5_000,
}: {
  message: Message;
  states: string[];
  task: () => Promise<T>;
  intervalMs?: number;
}) => {
  let index = 0;

  const editState = async () => {
    const content = states[Math.min(index, states.length - 1)];
    index += 1;

    try {
      await message.edit({
        content,
        allowedMentions: { users: [] },
        flags: MessageFlags.SuppressEmbeds,
      });
    } catch (error) {
      console.warn("[discord] failed to update progress message", error);
    }
  };

  await editState();
  const interval = setInterval(() => {
    if (index < states.length) {
      void editState();
    }
  }, intervalMs);

  try {
    return await task();
  } finally {
    clearInterval(interval);
  }
};
