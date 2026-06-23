import {
  ChannelType,
  type Client,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { config } from "../config.js";

const latestPrivateThreadByChannelId = new Map<string, string>();

export const rememberPrivateThreadForChannel = (
  channelId: string,
  threadUrl: string
) => {
  latestPrivateThreadByChannelId.set(channelId, threadUrl);
};

export const getPrivateDiagnosticsChannel = async (
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

type ActiveThreadListableChannel = TextBasedChannel & {
  id: string;
  threads: {
    fetchActive: () => Promise<{
      threads: {
        values: () => Iterable<{
          id: string;
          type: ChannelType;
          parentId: string | null;
          createdTimestamp: number | null;
        }>;
      };
    }>;
  };
};

const isActiveThreadListableChannel = (
  channel: TextBasedChannel
): channel is ActiveThreadListableChannel =>
  "id" in channel &&
  "threads" in channel &&
  typeof (
    channel as { threads?: { fetchActive?: unknown } }
  ).threads?.fetchActive === "function";

export const getLatestPrivateThreadUrl = async (message: Message) => {
  const mappedThreadUrl = latestPrivateThreadByChannelId.get(message.channel.id);

  if (mappedThreadUrl) {
    return mappedThreadUrl;
  }

  if (!message.guild || !isActiveThreadListableChannel(message.channel)) {
    return undefined;
  }

  const activeThreads = await message.channel.threads.fetchActive();
  const [latestThread] = Array.from(activeThreads.threads.values())
    .filter(
      (thread) =>
        thread.type === ChannelType.PrivateThread &&
        thread.parentId === message.channel.id
    )
    .sort(
      (left, right) =>
        (right.createdTimestamp ?? 0) - (left.createdTimestamp ?? 0)
    );

  if (!latestThread) {
    return undefined;
  }

  const threadUrl = `https://discord.com/channels/${message.guild.id}/${latestThread.id}`;
  rememberPrivateThreadForChannel(message.channel.id, threadUrl);
  return threadUrl;
};
