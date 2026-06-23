import {
  ChannelType,
  type Message,
  type PrivateThreadChannel,
  type TextBasedChannel,
} from "discord.js";
import { config } from "../config.js";
import type { DiscordBotToolkitClient } from "../composio/discord-bot.js";
import type { DebugFields } from "../support/debug-fields.js";
import type { PrivacyDecision } from "../support/privacy.js";

type ThreadableChannel = TextBasedChannel & {
  threads: {
    create: (options: {
      name: string;
      type: ChannelType.PrivateThread;
      invitable: false;
      reason: string;
    }) => Promise<PrivateThreadChannel>;
  };
};

const isThreadableChannel = (
  channel: TextBasedChannel
): channel is ThreadableChannel => "threads" in channel;

const sanitizeThreadName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const compactValue = (value: string) =>
  sanitizeThreadName(value).slice(0, 24);

const pickDebugSubject = (fields: DebugFields) => {
  if (fields.org_id) {
    return compactValue(fields.org_id);
  }

  if (fields.project_id) {
    return compactValue(fields.project_id);
  }

  if (fields.toolkit) {
    return compactValue(fields.toolkit);
  }

  if (fields.tool) {
    return compactValue(fields.tool);
  }

  if (fields.org_member_email) {
    const [localPart] = fields.org_member_email.split("@");
    return compactValue(localPart);
  }

  if (fields.user_id) {
    return compactValue(fields.user_id);
  }

  if (fields.request_id) {
    return compactValue(fields.request_id);
  }

  return undefined;
};

const buildThreadName = (
  message: Message,
  decision: PrivacyDecision,
  fields: DebugFields
) => {
  const parts = [
    config.privateThreadNamePrefix,
    fields.environment ? compactValue(fields.environment) : undefined,
    decision.route,
    pickDebugSubject(fields),
  ].filter(Boolean);

  if (parts.length < 3) {
    parts.push(message.id.slice(-6));
  }

  return sanitizeThreadName(parts.join("-"));
};

export const createPrivateInvestigationThread = async (
  message: Message,
  decision: PrivacyDecision,
  fields: DebugFields = {},
  targetChannel: TextBasedChannel = message.channel,
  discordBot?: DiscordBotToolkitClient
) => {
  if (!message.guild) {
    throw new Error("Private diagnostics require a guild channel.");
  }

  if (!isThreadableChannel(targetChannel)) {
    throw new Error("This channel cannot create private threads.");
  }

  if (decision.staffUserIds.length === 0) {
    throw new Error(
      `No staff users configured for ${decision.route} private diagnostics.`
    );
  }

  const threadName = buildThreadName(message, decision, fields);
  const { thread, useDiscordBotActions } = await createThread({
    message,
    targetChannel,
    threadName,
    discordBot,
  });

  await addStaffMembers({
    thread,
    staffUserIds: decision.staffUserIds,
    discordBot: useDiscordBotActions ? discordBot : undefined,
  });

  return thread;
};

const createThread = async ({
  message,
  targetChannel,
  threadName,
  discordBot,
}: {
  message: Message;
  targetChannel: ThreadableChannel;
  threadName: string;
  discordBot?: DiscordBotToolkitClient;
}) => {
  if (discordBot?.enabled) {
    try {
      const threadId = await discordBot.createPrivateThread({
        channelId: targetChannel.id,
        name: threadName,
      });
      const channel = await message.client.channels.fetch(threadId);

      if (channel?.type !== ChannelType.PrivateThread) {
        throw new Error(
          `Discordbot created channel ${threadId}, but it was not a private thread.`
        );
      }

      console.log("[discordbot] created private diagnostics thread", {
        threadId,
        threadName,
      });

      return { thread: channel, useDiscordBotActions: true };
    } catch (error) {
      console.warn(
        "[discordbot] failed to create private thread, falling back to discord.js",
        error
      );
    }
  }

  return {
    thread: await targetChannel.threads.create({
      name: threadName,
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: "Private support diagnostics requested from public Discord.",
    }),
    useDiscordBotActions: false,
  };
};

const addStaffMembers = async ({
  thread,
  staffUserIds,
  discordBot,
}: {
  thread: PrivateThreadChannel;
  staffUserIds: string[];
  discordBot?: DiscordBotToolkitClient;
}) => {
  const failedAdds: string[] = [];

  for (const staffUserId of staffUserIds) {
    try {
      if (discordBot?.enabled) {
        await discordBot.addThreadMember({
          threadId: thread.id,
          userId: staffUserId,
        });
      } else {
        await thread.members.add(staffUserId);
      }
    } catch (error) {
      failedAdds.push(staffUserId);
      console.error("[discord] failed to add staff user to private thread", {
        staffUserId,
        error,
      });
    }
  }

  if (failedAdds.length > 0) {
    throw new Error(
      `Created private thread, but failed to add staff users: ${failedAdds.join(", ")}`
    );
  }
};
