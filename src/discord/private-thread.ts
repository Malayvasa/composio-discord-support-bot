import {
  ChannelType,
  type Message,
  type PrivateThreadChannel,
  type TextBasedChannel,
} from "discord.js";
import { config } from "../config.js";
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

export const createPrivateInvestigationThread = async (
  message: Message,
  decision: PrivacyDecision
) => {
  if (!message.guild) {
    throw new Error("Private diagnostics require a guild channel.");
  }

  if (!isThreadableChannel(message.channel)) {
    throw new Error("This channel cannot create private threads.");
  }

  if (decision.staffUserIds.length === 0) {
    throw new Error(
      `No staff users configured for ${decision.route} private diagnostics.`
    );
  }

  const threadName = sanitizeThreadName(
    `${config.privateThreadNamePrefix}-${decision.route}-${message.id}`
  );

  const thread = await message.channel.threads.create({
    name: threadName,
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: "Private support diagnostics requested from public Discord.",
  });

  const failedAdds: string[] = [];

  for (const staffUserId of decision.staffUserIds) {
    try {
      await thread.members.add(staffUserId);
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

  return thread;
};

