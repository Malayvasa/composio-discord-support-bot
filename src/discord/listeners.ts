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
import {
  collectSupportAttachments,
  formatAttachmentMetadata,
} from "../support/attachments.js";
import { formatDebugFields, parseDebugFields } from "../support/debug-fields.js";
import { classifyPrivacy, isConfiguredStaffUser } from "../support/privacy.js";
import {
  formatMessageForContext,
  isFetchableMessageChannel,
  isSendableChannel,
  splitDiscordMessage,
  withTypingHeartbeat,
} from "../utils/discord.js";

const isPrivateThread = (message: Message) =>
  message.channel.type === ChannelType.PrivateThread;

const latestPrivateThreadByChannelId = new Map<string, string>();

const isPublicThread = (message: Message) =>
  message.channel.type === ChannelType.PublicThread ||
  message.channel.type === ChannelType.AnnouncementThread;

const getParentChannelId = (message: Message) =>
  "parentId" in message.channel ? message.channel.parentId : undefined;

const getThreadOwnerId = (message: Message) =>
  "ownerId" in message.channel ? message.channel.ownerId : undefined;

const getChannelName = (message: Message) =>
  "name" in message.channel && typeof message.channel.name === "string"
    ? message.channel.name
    : undefined;

const isAllowedForumThreadOwner = (message: Message) => {
  if (!isPublicThread(message) || config.supportForumAuthorIds.length === 0) {
    return true;
  }

  const ownerId = getThreadOwnerId(message);
  return ownerId ? config.supportForumAuthorIds.includes(ownerId) : false;
};

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
  const parentChannelId = getParentChannelId(message);
  const inConfiguredSupportSurface =
    config.supportChannelIds.length === 0 ||
    config.supportChannelIds.includes(message.channel.id) ||
    (parentChannelId
      ? config.supportChannelIds.includes(parentChannelId)
      : false);
  const inRestrictedForumThread =
    isPublicThread(message) &&
    typeof parentChannelId === "string" &&
    config.supportChannelIds.includes(parentChannelId) &&
    !isAllowedForumThreadOwner(message);

  if (inRestrictedForumThread) {
    return false;
  }

  const inSupportChannel = inConfiguredSupportSurface;
  const command = message.content.trim().startsWith("!support");

  return mentioned || command || inSupportChannel;
};

const isExplicitRequest = (client: Client, message: Message) => {
  const mentioned = client.user ? message.mentions.has(client.user) : false;
  const command = message.content.trim().startsWith("!support");

  return mentioned || command;
};

const isAutoForumPost = (message: Message) => {
  const parentChannelId = getParentChannelId(message);

  return (
    isPublicThread(message) &&
    typeof parentChannelId === "string" &&
    config.supportChannelIds.includes(parentChannelId)
  );
};

const isLikelyNonSupportPost = (message: Message, customerMessage: string) => {
  const text = `${getChannelName(message) ?? ""} ${customerMessage}`.toLowerCase();

  return /\b(hiring|job application|job specialist|remote role|rlhf|we'?re hiring|approved to be judge|hackathon judge)\b/i.test(
    text
  );
};

const isGenericDiagnosticsFollowup = (message: string) =>
  /^(what can you tell me|what do you see|any update|update\??|can you check|check this|continue|go on|what happened|thoughts\??)\??$/i.test(
    message.trim()
  );

const shouldTagStaff = (
  message: Message,
  customerMessage: string,
  answer: string,
  staffUserIds: string[]
) => {
  if (staffUserIds.length === 0 || isPrivateThread(message)) {
    return false;
  }

  const text = `${getChannelName(message) ?? ""} ${customerMessage} ${answer}`.toLowerCase();

  return /\b(staff action|needs staff|blocked|fully blocked|urgent|production|prod|outage|incident|security|billing|refund|frozen|cannot upgrade|can't upgrade|5\d\d|503|down|unresponsive|provider bug|toolkit bug|maintainer|owner)\b/i.test(
    text
  );
};

const formatStaffMentions = (staffUserIds: string[]) =>
  staffUserIds.map((userId) => `<@${userId}>`).join(" ");

const getPrivateDiagnosticsChannel = async (
  client: Client,
  message: Message
) => {
  if (!config.privateDiagnosticsChannelId) {
    return message.channel;
  }

  const channel = await client.channels.fetch(config.privateDiagnosticsChannelId);

  if (!channel?.isTextBased()) {
    throw new Error(
      "PRIVATE_DIAGNOSTICS_CHANNEL_ID must point to a text channel that can create private threads."
    );
  }

  return channel;
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

const buildDiscordContext = async (
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
    const hasAttachments = message.attachments.size > 0;

    if (
      isAutoForumPost(message) &&
      !isExplicitRequest(client, message) &&
      isLikelyNonSupportPost(message, customerMessage)
    ) {
      return;
    }

    if (!customerMessage && !hasAttachments) {
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
      const discordContext = await buildDiscordContext(channel, message);
      const latestCustomerMessage =
        customerMessage || "[attachment-only support request]";
      const debugFields = parseDebugFields(latestCustomerMessage);
      const decision = classifyPrivacy(latestCustomerMessage, debugFields, {
        hasAttachments,
      });

      if (
        !isPrivateThread(message) &&
        !decision.requiresPrivateDiagnostics &&
        config.privateDiagnosticsChannelId === message.channel.id &&
        isGenericDiagnosticsFollowup(latestCustomerMessage)
      ) {
        const threadUrl = latestPrivateThreadByChannelId.get(message.channel.id);

        if (threadUrl) {
          await thinking.edit(
            [
              "I opened a private investigation thread for this case.",
              `Please continue there so the diagnostic context stays together: ${threadUrl}`,
            ].join("\n")
          );
          return;
        }
      }

      if (decision.requiresPrivateDiagnostics && !isPrivateThread(message)) {
        const diagnosticsChannel = await getPrivateDiagnosticsChannel(
          client,
          message
        );
        const thread = await createPrivateInvestigationThread(
          message,
          decision,
          debugFields,
          diagnosticsChannel
        );
        const threadUrl = `https://discord.com/channels/${message.guild?.id}/${thread.id}`;
        const staffMentions = formatStaffMentions(decision.staffUserIds);
        latestPrivateThreadByChannelId.set(message.channel.id, threadUrl);

        await thinking.edit(
          [
            "This may involve private account, org, log, or diagnostics data.",
            `I opened a private staff investigation thread: ${threadUrl}`,
            "I will keep public updates sanitized.",
          ].join("\n")
        );

        const attachments = await collectSupportAttachments(message);

        const privateStartMessage = [
          staffMentions,
          "",
          "Private support investigation started.",
          `Private thread: ${threadUrl}`,
          `Public message: ${message.url}`,
          `Route: ${decision.route}`,
          "",
          "Debug fields:",
          formatDebugFields(debugFields),
          "",
          attachments.length > 0
            ? `Attachments: ${formatAttachmentMetadata(attachments).replace(/\n/g, "; ")}`
            : "Attachments: none provided",
        ].join("\n");

        await thread.send({
          content: privateStartMessage,
          allowedMentions: { users: decision.staffUserIds },
        });

        const supportSession = await sessions.getSupportSession();
        const privateAnswer = await withTypingHeartbeat(thread, () =>
          runSupportAgent({
            customerMessage: latestCustomerMessage,
            discordContext,
            discordMessageUrl: message.url,
            mode: "private",
            tools: supportSession.tools,
            composioSessionId: supportSession.sessionId,
            composioUserId: supportSession.userId,
            debugFields,
            attachments,
          })
        );

        await sendLongChannelMessage(thread, privateAnswer);
        return;
      }

      const attachments = await collectSupportAttachments(message);
      const supportSession = isPrivateThread(message)
        ? await sessions.getSupportSession()
        : config.publicDocsToolkits.length > 0
          ? await sessions.getPublicDocsSession()
          : undefined;
      const answer = await withTypingHeartbeat(channel, () =>
        runSupportAgent({
          customerMessage: latestCustomerMessage,
          discordContext,
          discordMessageUrl: message.url,
          mode: isPrivateThread(message) ? "private" : "public",
          tools: supportSession?.tools,
          composioSessionId: supportSession?.sessionId,
          composioUserId: supportSession?.userId,
          debugFields,
          attachments,
        })
      );

      const chunks = splitDiscordMessage(answer);
      const shouldMentionStaff = shouldTagStaff(
        message,
        latestCustomerMessage,
        answer,
        decision.staffUserIds
      );
      const firstChunk = chunks.shift() ?? "I could not produce a response.";

      await thinking.edit({
        content: shouldMentionStaff
          ? `${firstChunk}\n\n${formatStaffMentions(decision.staffUserIds)} tagging staff because this may need owner action.`
          : firstChunk,
        allowedMentions: shouldMentionStaff
          ? { users: decision.staffUserIds }
          : { users: [] },
      });

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
