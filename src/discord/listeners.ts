import {
  ChannelType,
  type Client,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { config } from "../config.js";
import type { SupportSessionManager } from "../composio/session.js";
import { createPrivateInvestigationThread } from "./private-thread.js";
import { runSupportAgent } from "../support/agent.js";
import { formatDebugFields, parseDebugFields } from "../support/debug-fields.js";
import { classifyPrivacy, isConfiguredStaffUser } from "../support/privacy.js";
import {
  formatMessageForContext,
  isFetchableMessageChannel,
  isSendableChannel,
  splitDiscordMessage,
} from "../utils/discord.js";

const isPrivateThread = (message: Message) =>
  message.channel.type === ChannelType.PrivateThread;

const shouldRespond = (client: Client, message: Message) => {
  if (message.author.bot) {
    return false;
  }

  if (isPrivateThread(message)) {
    return (
      isConfiguredStaffUser(message.author.id) &&
      message.content.trim().startsWith("!support")
    );
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

const sendLongChannelMessage = async (
  channel: TextBasedChannel,
  text: string
) => {
  if (!isSendableChannel(channel)) {
    return;
  }

  const chunks = splitDiscordMessage(text);

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
      const discordContext = await getDiscordContext(channel, message);
      const debugFields = parseDebugFields(customerMessage);
      const decision = classifyPrivacy(customerMessage, debugFields);

      if (decision.requiresPrivateDiagnostics && !isPrivateThread(message)) {
        const thread = await createPrivateInvestigationThread(
          message,
          decision,
          debugFields
        );
        const threadUrl = `https://discord.com/channels/${message.guild?.id}/${thread.id}`;
        const staffMentions = decision.staffUserIds
          .map((userId) => `<@${userId}>`)
          .join(" ");

        await thinking.edit(
          [
            "This may involve private account, org, log, or diagnostics data.",
            `I opened a private staff investigation thread: ${threadUrl}`,
            "I will keep public updates sanitized.",
          ].join("\n")
        );

        await thread.send({
          content: [
            staffMentions,
            "",
            "Private support investigation started.",
            `Private thread: ${threadUrl}`,
            `Public message: ${message.url}`,
            `Route: ${decision.route}`,
            `Privacy reasons: ${decision.reasons.join(", ")}`,
            "",
            "Parsed @debug fields:",
            formatDebugFields(debugFields),
          ].join("\n"),
          allowedMentions: { users: decision.staffUserIds },
        });

        const supportSession = await sessions.getSupportSession();
        const privateAnswer = await runSupportAgent({
          customerMessage,
          discordContext,
          discordMessageUrl: message.url,
          mode: "private",
          tools: supportSession.tools,
          composioSessionId: supportSession.sessionId,
          composioUserId: supportSession.userId,
          debugFields,
        });

        await sendLongChannelMessage(thread, privateAnswer);
        return;
      }

      const supportSession = isPrivateThread(message)
        ? await sessions.getSupportSession()
        : undefined;
      const answer = await runSupportAgent({
        customerMessage,
        discordContext,
        discordMessageUrl: message.url,
        mode: isPrivateThread(message) ? "private" : "public",
        tools: supportSession?.tools,
        composioSessionId: supportSession?.sessionId,
        composioUserId: supportSession?.userId,
        debugFields,
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
          "I could not safely start the private diagnostics flow, so I did not run internal tool checks.",
          "Please ask a support admin to verify private thread permissions and staff routing env vars.",
        ].join("\n")
      );
    }
  });
};
