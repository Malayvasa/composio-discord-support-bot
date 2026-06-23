import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { config } from "../config.js";

type DiscordBotToolSlug =
  | "DISCORDBOT_CREATE_THREAD"
  | "DISCORDBOT_ADD_THREAD_MEMBER"
  | "DISCORDBOT_CREATE_MESSAGE";

interface DiscordBotToolResponse<T> {
  data?: T;
  error?: unknown;
  successful?: boolean;
}

export class DiscordBotToolkitClient {
  private readonly composio = new Composio({
    apiKey: config.composioApiKey,
    provider: new VercelProvider(),
  });

  get enabled() {
    return config.discordBotActionsEnabled;
  }

  async createPrivateThread({
    channelId,
    name,
  }: {
    channelId: string;
    name: string;
  }) {
    const data = await this.execute<Record<string, unknown>>(
      "DISCORDBOT_CREATE_THREAD",
      {
        channel_id: channelId,
        name,
        type: 12,
        invitable: false,
        auto_archive_duration: 1440,
      }
    );

    return this.extractId(data, "thread");
  }

  async addThreadMember({
    threadId,
    userId,
  }: {
    threadId: string;
    userId: string;
  }) {
    await this.execute("DISCORDBOT_ADD_THREAD_MEMBER", {
      channel_id: threadId,
      user_id: userId,
    });
  }

  async createMessage({
    channelId,
    content,
    allowedUserIds = [],
  }: {
    channelId: string;
    content: string;
    allowedUserIds?: string[];
  }) {
    await this.execute("DISCORDBOT_CREATE_MESSAGE", {
      channel_id: channelId,
      content,
      allowed_mentions: {
        users: allowedUserIds,
        parse: [],
      },
    });
  }

  private async execute<T>(
    slug: DiscordBotToolSlug,
    args: Record<string, unknown>
  ) {
    if (!this.enabled) {
      throw new Error("Discordbot toolkit actions are disabled.");
    }

    const response = (await this.composio.tools.execute(slug, {
      userId: config.supportSessionUserId,
      version: config.discordBotToolVersion,
      ...(config.discordBotConnectedAccountId
        ? { connectedAccountId: config.discordBotConnectedAccountId }
        : {}),
      arguments: args,
    })) as DiscordBotToolResponse<T>;

    if (response.error || response.successful === false) {
      throw new Error(`${slug} failed: ${JSON.stringify(response.error ?? response)}`);
    }

    return response.data as T;
  }

  private extractId(data: Record<string, unknown>, label: string) {
    const directId = data.id;

    if (typeof directId === "string") {
      return directId;
    }

    for (const key of [label, "channel", "thread", "result", "data"]) {
      const value = data[key];
      if (value && typeof value === "object" && "id" in value) {
        const nestedId = (value as { id?: unknown }).id;
        if (typeof nestedId === "string") {
          return nestedId;
        }
      }
    }

    throw new Error(`Discordbot ${label} response did not include an id.`);
  }
}
