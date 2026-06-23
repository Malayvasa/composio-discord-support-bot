import { Composio } from "@composio/client";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { config } from "../config.js";

const client = new Composio({ apiKey: config.composioApiKey });

const maxItems = 12;

const compactSchema = (schema: Record<string, unknown> | undefined) => {
  if (!schema) {
    return undefined;
  }

  const properties =
    schema.properties && typeof schema.properties === "object"
      ? Object.keys(schema.properties as Record<string, unknown>).slice(0, 30)
      : [];
  const required = Array.isArray(schema.required)
    ? schema.required.slice(0, 30)
    : [];

  return {
    required,
    properties,
  };
};

const summarizeToolkit = (toolkit: {
  slug: string;
  name: string;
  enabled?: boolean;
  auth_guide_url?: string | null;
  composio_managed_auth_schemes?: string[];
  auth_config_details?: Array<{ mode?: string; name?: string }>;
  meta?: {
    description?: string;
    version?: string;
    available_versions?: string[];
    tools_count?: number;
    triggers_count?: number;
    categories?: Array<{ slug?: string; name?: string }>;
    updated_at?: string;
  };
}) => ({
  slug: toolkit.slug,
  name: toolkit.name,
  enabled: toolkit.enabled,
  description: toolkit.meta?.description,
  currentVersion: toolkit.meta?.version,
  availableVersions: toolkit.meta?.available_versions,
  toolsCount: toolkit.meta?.tools_count,
  triggersCount: toolkit.meta?.triggers_count,
  categories: toolkit.meta?.categories?.map((category) => category.slug ?? category.name),
  authModes: toolkit.auth_config_details
    ?.map((detail) => detail.mode ?? detail.name)
    .filter(Boolean),
  managedAuthSchemes: toolkit.composio_managed_auth_schemes,
  authGuideUrl: toolkit.auth_guide_url,
  updatedAt: toolkit.meta?.updated_at,
});

const summarizeTool = (item: {
  slug: string;
  name: string;
  description?: string;
  human_description?: string;
  version?: string;
  available_versions?: string[];
  scopes?: string[];
  tags?: string[];
  no_auth?: boolean;
  is_deprecated?: boolean;
  toolkit?: { slug?: string; name?: string };
  input_parameters?: Record<string, unknown>;
  output_parameters?: Record<string, unknown>;
}) => ({
  slug: item.slug,
  name: item.name,
  toolkit: item.toolkit?.slug ?? item.toolkit?.name,
  description: item.human_description ?? item.description,
  currentVersion: item.version,
  availableVersions: item.available_versions,
  scopes: item.scopes?.slice(0, 30),
  tags: item.tags?.slice(0, 20),
  noAuth: item.no_auth,
  deprecated: item.is_deprecated,
  input: compactSchema(item.input_parameters),
  output: compactSchema(item.output_parameters),
});

const lookupInput = z.object({
  action: z
    .enum(["search_toolkits", "get_toolkit", "search_tools", "get_tool"])
    .describe("The Composio catalog lookup to run."),
  query: z
    .string()
    .optional()
    .describe("Search text for toolkit/tool discovery."),
  toolkitSlug: z
    .string()
    .optional()
    .describe("Toolkit slug, for example github, gmail, slack, or datadog."),
  toolSlug: z
    .string()
    .optional()
    .describe("Tool slug, for example GITHUB_CREATE_ISSUE."),
  version: z
    .string()
    .optional()
    .describe("Optional specific tool version to retrieve."),
  toolkitVersion: z
    .string()
    .optional()
    .describe('Toolkit version to use for listing/retrieval. Use "latest" for current latest.'),
});

export const composioCatalogTools: ToolSet = {
  lookupComposioCatalog: tool({
    description:
      "Read-only lookup against the Composio API catalog. Use this for current toolkit availability, toolkit versions, tool lists, tool versions, scopes, auth modes, and input/output schemas.",
    inputSchema: lookupInput,
    execute: async (input) => {
      const toolkitVersions = input.toolkitVersion
        ? input.toolkitSlug
          ? { [input.toolkitSlug]: input.toolkitVersion }
          : input.toolkitVersion
        : "latest";

      switch (input.action) {
        case "get_toolkit": {
          if (!input.toolkitSlug) {
            return { error: "toolkitSlug is required for get_toolkit." };
          }

          const toolkit = await client.toolkits.retrieve(input.toolkitSlug, {
            version: input.toolkitVersion,
          });
          return {
            kind: "toolkit",
            toolkit: summarizeToolkit(toolkit),
          };
        }

        case "search_toolkits": {
          const response = await client.toolkits.list({
            search: input.query || input.toolkitSlug,
            limit: maxItems,
            managed_by: "composio",
            sort_by: "usage",
          });
          return {
            kind: "toolkit_search",
            totalItems: response.total_items,
            nextCursor: response.next_cursor,
            items: response.items.slice(0, maxItems).map(summarizeToolkit),
          };
        }

        case "get_tool": {
          if (!input.toolSlug) {
            return { error: "toolSlug is required for get_tool." };
          }

          const toolInfo = await client.tools.retrieve(input.toolSlug, {
            version: input.version,
            toolkit_versions: toolkitVersions,
          });
          return {
            kind: "tool",
            tool: summarizeTool(toolInfo),
          };
        }

        case "search_tools": {
          const response = await client.tools.list({
            query: input.query,
            toolkit_slug: input.toolkitSlug,
            toolkit_versions: toolkitVersions,
            limit: maxItems,
          });
          return {
            kind: "tool_search",
            totalItems: response.total_items,
            totalPages: response.total_pages,
            nextCursor: response.next_cursor,
            items: response.items.slice(0, maxItems).map(summarizeTool),
          };
        }
      }
    },
  }),
};
