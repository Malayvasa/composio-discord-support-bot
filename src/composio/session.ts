import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { ToolSet } from "ai";
import { config } from "../config.js";

export interface SupportComposioSession {
  userId: string;
  sessionId: string | undefined;
  tools: ToolSet;
}

export class SupportSessionManager {
  private readonly composio = new Composio({
    apiKey: config.composioApiKey,
    provider: new VercelProvider(),
  });

  private readonly sessions = new Map<string, Promise<SupportComposioSession>>();

  getSupportSession(userId = config.supportSessionUserId) {
    return this.getSession({
      userId,
      toolkits: config.composioToolkits,
      label: "support",
    });
  }

  getPublicDocsSession(userId = config.supportSessionUserId) {
    return this.getSession({
      userId,
      toolkits: config.publicDocsToolkits,
      label: "public docs",
    });
  }

  private getSession({
    userId,
    toolkits,
    label,
  }: {
    userId: string;
    toolkits: string[];
    label: string;
  }) {
    const cacheKey = `${userId}:${toolkits.join(",")}:${label}`;
    const cached = this.sessions.get(cacheKey);

    if (cached) {
      return cached;
    }

    const sessionPromise = this.createSession(userId, toolkits, label);
    this.sessions.set(cacheKey, sessionPromise);
    return sessionPromise;
  }

  private async createSession(
    userId: string,
    toolkits: string[],
    label: string
  ): Promise<SupportComposioSession> {
    const session = await this.composio.create(userId, {
      toolkits: {
        enable: toolkits,
      },
      workbench: {
        enable: config.composioWorkbenchEnabled,
      },
    });

    const tools = await session.tools();
    const sessionId =
      "sessionId" in session && typeof session.sessionId === "string"
        ? session.sessionId
        : undefined;

    console.log(`[composio] ${label} session ready`, {
      userId,
      sessionId,
      toolkits,
      toolCount: Object.keys(tools).length,
    });

    return {
      userId,
      sessionId,
      tools,
    };
  }
}
