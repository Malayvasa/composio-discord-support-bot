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
    const cached = this.sessions.get(userId);

    if (cached) {
      return cached;
    }

    const sessionPromise = this.createSupportSession(userId);
    this.sessions.set(userId, sessionPromise);
    return sessionPromise;
  }

  private async createSupportSession(
    userId: string
  ): Promise<SupportComposioSession> {
    const session = await this.composio.create(userId, {
      toolkits: {
        enable: config.composioToolkits,
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

    console.log("[composio] support session ready", {
      userId,
      sessionId,
      toolkits: config.composioToolkits,
      toolCount: Object.keys(tools).length,
    });

    return {
      userId,
      sessionId,
      tools,
    };
  }
}

