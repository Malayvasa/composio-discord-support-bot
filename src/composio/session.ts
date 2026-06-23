import { Composio } from "@composio/core";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { config } from "../config.js";

export interface SupportComposioSession {
  userId: string;
  sessionId: string;
  tools: ToolSet;
}

export class SupportSessionManager {
  private readonly composio = new Composio({
    apiKey: config.composioApiKey,
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

    const tools: ToolSet = {
      searchComposioSessionTools: tool({
        description:
          "Search the enabled Composio session tools by use case before choosing a tool slug to execute. Use this for docs search, Datadog, Metabase, and other enabled support session tools.",
        inputSchema: z.object({
          query: z
            .string()
            .min(1)
            .describe(
              "Plain-English use case, for example 'search docs.composio.dev for MCP authentication' or 'find Datadog logs for request id'."
            ),
          toolkits: z
            .array(z.string().min(1))
            .optional()
            .describe("Optional toolkit slugs to narrow search."),
        }),
        execute: async ({ query, toolkits }) =>
          session.search({
            query,
            toolkits,
          }),
      }),
      executeComposioSessionTool: tool({
        description:
          "Execute a Composio session tool by slug after searching for the right tool. Keep arguments strictly aligned with the searched tool schema.",
        inputSchema: z.object({
          toolSlug: z
            .string()
            .min(1)
            .describe(
              "Exact Composio tool slug returned by searchComposioSessionTools."
            ),
          arguments: z
            .record(z.string(), z.unknown())
            .default({})
            .describe("Arguments for the selected Composio tool."),
        }),
        execute: async ({ toolSlug, arguments: args }) =>
          session.execute(toolSlug, args),
      }),
      listComposioSessionToolkits: tool({
        description:
          "List enabled toolkits and connection state for the active Composio support session.",
        inputSchema: z.object({
          toolkits: z
            .array(z.string().min(1))
            .optional()
            .describe("Optional toolkit slugs to filter."),
        }),
        execute: async ({ toolkits }) =>
          session.toolkits({
            toolkits,
          }),
      }),
    };

    console.log(`[composio] ${label} session ready`, {
      userId,
      sessionId: session.sessionId,
      toolkits,
      toolCount: Object.keys(tools).length,
    });

    return {
      userId,
      sessionId: session.sessionId,
      tools,
    };
  }
}
