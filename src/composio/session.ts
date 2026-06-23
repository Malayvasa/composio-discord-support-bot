import { Composio } from "@composio/core";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { config } from "../config.js";

const SENSITIVE_KEY_PATTERN =
  /(?:token|secret|credential|password|api[_-]?key|access[_-]?key|refresh[_-]?key|private[_-]?key|client[_-]?secret|authorization|cookie|bearer)/i;

const sanitizeForSupport = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForSupport);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([key, nestedValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? "[redacted]"
          : sanitizeForSupport(nestedValue),
      ]
    )
  );
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
      includeConnectedAccountLookup: true,
    });
  }

  getPublicDocsSession(userId = config.supportSessionUserId) {
    return this.getSession({
      userId,
      toolkits: config.publicDocsToolkits,
      label: "public docs",
      includeConnectedAccountLookup: false,
    });
  }

  private getSession({
    userId,
    toolkits,
    label,
    includeConnectedAccountLookup,
  }: {
    userId: string;
    toolkits: string[];
    label: string;
    includeConnectedAccountLookup: boolean;
  }) {
    const cacheKey = `${userId}:${toolkits.join(",")}:${label}:${includeConnectedAccountLookup}`;
    const cached = this.sessions.get(cacheKey);

    if (cached) {
      return cached;
    }

    const sessionPromise = this.createSession({
      userId,
      toolkits,
      label,
      includeConnectedAccountLookup,
    });
    this.sessions.set(cacheKey, sessionPromise);
    return sessionPromise;
  }

  private async createSession({
    userId,
    toolkits,
    label,
    includeConnectedAccountLookup,
  }: {
    userId: string;
    toolkits: string[];
    label: string;
    includeConnectedAccountLookup: boolean;
  }): Promise<SupportComposioSession> {
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

    if (includeConnectedAccountLookup) {
      tools.lookupComposioConnectedAccount = tool({
        description:
          "Retrieve sanitized Composio connected-account metadata by connected account ID. Use this in private support mode whenever a user provides ca_... or connectionId before asking for project_id, org_id, user_id, toolkit, status, or auth config details.",
        inputSchema: z.object({
          connectedAccountId: z
            .string()
            .regex(/^ca_[A-Za-z0-9_-]+$/)
            .describe("Connected account ID, for example ca_abc123."),
        }),
        execute: async ({ connectedAccountId }) => {
          try {
            const account =
              await this.composio.connectedAccounts.get(connectedAccountId);
            const safeAccount = sanitizeForSupport(account) as Record<
              string,
              unknown
            >;

            return {
              found: true,
              connectedAccountId,
              account: safeAccount,
              guidance:
                "Use this connected-account metadata as the primary source for project/user/toolkit/auth context. Ask for project_id or org_id only if the retrieved metadata and available diagnostics still cannot resolve the needed tenant context.",
            };
          } catch (error) {
            return {
              found: false,
              connectedAccountId,
              error: errorMessage(error),
              guidance:
                "Say the connected account lookup was unavailable or not found before asking for another identifier. If needed, ask for project_id/org_id as a fallback.",
            };
          }
        },
      });
    }

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
