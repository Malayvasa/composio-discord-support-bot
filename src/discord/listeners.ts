import type { Client, Message, TextBasedChannel } from "discord.js";
import { config } from "../config.js";
import type { SupportSessionManager } from "../composio/session.js";
import { runSupportAgent } from "../support/agent.js";
import {
  formatMessageForContext,
  isFetchableMessageChannel,
  isSendableChannel,
  splitDiscordMessage,
} from "../utils/discord.js";

const shouldRespond = (client: Client, message: Message) => {
  if (message.author.bot) {
    return false;
  }

  if (!message.guild) {
    return true;
  }

  const mentioned = client.user ? message.mentions.has(client.user) : false;
  const inSupportChannel =
    config.supportChannelIds.length === 0 ||
    config.supportChannelIds.includes(message.channel.id);
  const command = message.content.trim().startsWith("!support");

  return mentioned || command || inSupportChannel;
};

const cleanCustomerMessage = (client: Client, message: Message) => {
  let content = message.content.trim();

  if (client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "");
  }

  return content.replace(/^!support\s*/i, "").trim();
};

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

const sendLongReply = async (message: Message, text: string) => {
  const channel = message.channel;

  if (!isSendableChannel(channel)) {
    return;
  }

  const chunks = splitDiscordMessage(text);
  await message.reply({
    content: chunks.shift() ?? "I could not produce a response.",
    allowedMentions: { repliedUser: false },
  });

  for (const chunk of chunks) {
    await channel.send({
      content: chunk,
      allowedMentions: { users: [] },
    });
  }
};

export const registerSupportListeners = (
  client: Client,
  sessions: SupportSessionManager
) => {
  client.on("messageCreate", async (message) => {
    if (!shouldRespond(client, message)) {
      return;
    }

    const customerMessage = cleanCustomerMessage(client, message);

    if (!customerMessage) {
      await sendLongReply(
        message,
        "Tell me what is going wrong, and include a request ID, trace ID, toolkit slug, or timeframe if you have one."
      );
      return;
    }

    const channel = message.channel;

    if (!isSendableChannel(channel)) {
      return;
    }

    const thinking = await message.reply({
      content: "Looking into this...",
      allowedMentions: { repliedUser: false },
    });

    try {
      await channel.sendTyping();
      const supportSession = await sessions.getSupportSession();
      const discordContext = await getDiscordContext(channel, message);
      const answer = await runSupportAgent({
        customerMessage,
        discordContext,
        discordMessageUrl: message.url,
        tools: supportSession.tools,
      });

      const chunks = splitDiscordMessage(answer);
      await thinking.edit(chunks.shift() ?? "I could not produce a response.");

      for (const chunk of chunks) {
        await channel.send({
          content: chunk,
          allowedMentions: { users: [] },
        });
      }
    } catch (error) {
      console.error("[discord] failed to process support message", error);
      await thinking.edit(
        [
          "I hit an error while investigating this.",
          "Please include the request ID, trace ID, toolkit slug, environment, and timeframe, then a teammate can continue from there.",
        ].join("\n")
      );
    }
  });
};

