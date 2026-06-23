import { MessageFlags, type Client } from "discord.js";
import { config } from "../config.js";
import type { SupportSessionManager } from "../composio/session.js";
import { createPrivateInvestigationThread } from "./private-thread.js";
import { runSupportAgent } from "../support/agent.js";
import { collectSupportAttachments } from "../support/attachments.js";
import { parseDebugFields } from "../support/debug-fields.js";
import { classifyPrivacy } from "../support/privacy.js";
import { isSendableChannel, withTypingHeartbeat } from "../utils/discord.js";
import {
  buildDiscordContext,
  buildPrivateCaseContext,
} from "./support-context.js";
import {
  cleanCustomerMessage,
  formatStaffMentions,
  isAutoForumPost,
  isExplicitRequest,
  isGenericDiagnosticsFollowup,
  isLikelyNonSupportPost,
  isPrivateThread,
  shouldRespond,
  shouldTagStaff,
} from "./message-routing.js";
import {
  getLatestPrivateThreadUrl,
  getPrivateDiagnosticsChannel,
  rememberPrivateThreadForChannel,
} from "./private-diagnostics.js";
import {
  editReplyWithLongMessage,
  sendLongReply,
  withProgressUpdates,
} from "./replies.js";

const publicProgressStates = [
  "Looking into this...\n\nStep: Reading the support request.",
  "Looking into this...\n\nStep: Checking relevant Composio knowledge.",
  "Looking into this...\n\nStep: Drafting a short reply.",
];

const privateProgressStates = [
  "Working on this in the private thread...\n\nStep: Reviewing the case summary.",
  "Working on this in the private thread...\n\nStep: Checking available support tools.",
  "Working on this in the private thread...\n\nStep: Writing a customer-safe update.",
];

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
      flags: MessageFlags.SuppressEmbeds,
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
        const threadUrl = await getLatestPrivateThreadUrl(message);

        if (threadUrl) {
          await thinking.edit({
            content: [
              "I opened a private investigation thread for this case.",
              `Please continue there so the diagnostic context stays together: ${threadUrl}`,
            ].join("\n"),
            flags: MessageFlags.SuppressEmbeds,
          });
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
        rememberPrivateThreadForChannel(message.channel.id, threadUrl);

        await thinking.edit({
          content: [
            "This may involve private account, org, log, or diagnostics data.",
            `I opened a private staff investigation thread: ${threadUrl}`,
            "I will keep public updates sanitized.",
          ].join("\n"),
          flags: MessageFlags.SuppressEmbeds,
        });

        const attachments = await collectSupportAttachments(message);
        const privateCaseContext = buildPrivateCaseContext({
          message,
          decision,
          debugFields,
          attachments,
        });

        const privateStartMessage = [
          staffMentions,
          "",
          "**Private support investigation**",
          "Staff-only thread for account, log, or diagnostics context.",
          "",
          privateCaseContext,
        ].join("\n");

        await thread.send({
          content: privateStartMessage,
          allowedMentions: { users: decision.staffUserIds },
          flags: MessageFlags.SuppressEmbeds,
        });

        const privateProgress = await thread.send({
          content: privateProgressStates[0],
          allowedMentions: { users: [] },
          flags: MessageFlags.SuppressEmbeds,
        });

        const supportSession = await sessions.getSupportSession();
        const privateAnswer = await withProgressUpdates({
          message: privateProgress,
          states: privateProgressStates,
          task: () =>
            withTypingHeartbeat(thread, () =>
              runSupportAgent({
                customerMessage: latestCustomerMessage,
                discordContext: privateCaseContext,
                discordMessageUrl: message.url,
                mode: "private",
                tools: supportSession.tools,
                composioSessionId: supportSession.sessionId,
                composioUserId: supportSession.userId,
                debugFields,
                attachments,
              })
            ),
        });

        await editReplyWithLongMessage({
          reply: privateProgress,
          channel: thread,
          text: privateAnswer,
          allowedUserMentions: [],
        });
        return;
      }

      const attachments = await collectSupportAttachments(message);
      const supportSession = isPrivateThread(message)
        ? await sessions.getSupportSession()
        : config.publicDocsToolkits.length > 0
          ? await sessions.getPublicDocsSession()
          : undefined;
      const answer = await withProgressUpdates({
        message: thinking,
        states: isPrivateThread(message) ? privateProgressStates : publicProgressStates,
        task: () =>
          withTypingHeartbeat(channel, () =>
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
          ),
      });

      const shouldMentionStaff = shouldTagStaff(
        message,
        latestCustomerMessage,
        answer,
        decision.staffUserIds
      );
      await editReplyWithLongMessage({
        reply: thinking,
        channel,
        text: answer,
        firstMessageSuffix: shouldMentionStaff
          ? `${formatStaffMentions(decision.staffUserIds)} tagging staff because this may need owner action.`
          : undefined,
        allowedUserMentions: shouldMentionStaff ? decision.staffUserIds : [],
      });
    } catch (error) {
      console.error("[discord] failed to process support message", error);
      await thinking.edit({
        content: [
          "I could not safely start the private diagnostics flow, so I did not run internal tool checks.",
          "Please ask a support admin to verify private thread permissions and staff routing env vars.",
        ].join("\n"),
        flags: MessageFlags.SuppressEmbeds,
      });
    }
  });
};
