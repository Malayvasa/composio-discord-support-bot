import { Composio } from "@composio/client";
import { config } from "../config.js";

const client = new Composio({ apiKey: config.composioApiKey });

const redactString = (value: string) =>
  value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:ak|uak|sk|pk|org)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:ok|org|pr|ac|ca)_[A-Za-z0-9_-]{6,}\b/g, "[REDACTED_ID]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[REDACTED_UUID]"
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");

const safeValue = (value: unknown, depth = 0): unknown => {
  if (value == null) {
    return value;
  }

  if (depth > 5) {
    return "[MaxDepth]";
  }

  if (typeof value === "string") {
    const redacted = redactString(value);
    return redacted.length > 900
      ? `${redacted.slice(0, 900)}...[truncated ${redacted.length}]`
      : redacted;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return [
      ...value.slice(0, 8).map((item) => safeValue(item, depth + 1)),
      ...(value.length > 8 ? [`[+${value.length - 8} more]`] : []),
    ];
  }

  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (/authorization|token|secret|password|api.?key|cookie|headers/i.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = safeValue(nestedValue, depth + 1);
    }
  }

  return result;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const findNestedStrings = (value: unknown, pattern: RegExp, limit = 6) => {
  const matches: string[] = [];
  const visit = (nestedValue: unknown) => {
    if (matches.length >= limit || nestedValue == null) {
      return;
    }

    if (typeof nestedValue === "string") {
      if (pattern.test(nestedValue)) {
        matches.push(redactString(nestedValue));
      }
      pattern.lastIndex = 0;
      return;
    }

    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        visit(item);
      }
      return;
    }

    if (typeof nestedValue === "object") {
      for (const item of Object.values(nestedValue)) {
        visit(item);
      }
    }
  };

  visit(value);
  return Array.from(new Set(matches));
};

const extractToolSlugs = (value: unknown) => {
  const slugs = new Set<string>();
  const visit = (nestedValue: unknown) => {
    if (nestedValue == null) {
      return;
    }

    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        visit(item);
      }
      return;
    }

    if (typeof nestedValue === "object") {
      const record = nestedValue as Record<string, unknown>;

      if (typeof record.tool_slug === "string") {
        slugs.add(record.tool_slug);
      }

      for (const item of Object.values(record)) {
        visit(item);
      }
    }
  };

  visit(value);
  return Array.from(slugs).slice(0, 8);
};

const formatToolLog = (logId: string, log: Record<string, unknown>) => {
  const payload = log.payloadReceived;
  const response = log.response;
  const error = log.error;
  const app = asRecord(log.app);
  const toolSlugs = extractToolSlugs([payload, response, error]);
  const errorMessages = findNestedStrings(
    error,
    /\b(error|failed|invalid|unauthorized|forbidden|blocked|timeout|bad request|ssrf|dns)\b/i
  );
  const actionId = typeof log.actionId === "string" ? log.actionId : "unknown action";
  const status = typeof log.status === "string" ? log.status : "unknown";
  const appName =
    typeof app.name === "string"
      ? app.name
      : typeof app.uniqueId === "string"
        ? app.uniqueId
        : "unknown app";
  const startedAt =
    typeof log.startTime === "number" || typeof log.startTime === "string"
      ? new Date(log.startTime).toISOString()
      : "unknown time";

  return [
    `Log ID: ${logId}`,
    `Action: ${actionId}`,
    `App: ${appName}`,
    `Status: ${status}`,
    `Started at: ${startedAt}`,
    toolSlugs.length ? `Nested tool slugs: ${toolSlugs.join(", ")}` : "",
    errorMessages.length ? `Error summary: ${errorMessages.join(" | ")}` : "",
    "Sanitized payload:",
    JSON.stringify(safeValue(payload), null, 2),
    response ? "Sanitized response:" : "",
    response ? JSON.stringify(safeValue(response), null, 2) : "",
    error ? "Sanitized error:" : "",
    error ? JSON.stringify(safeValue(error), null, 2) : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const fetchComposioToolLogSummaries = async (logIds: string) => {
  const ids = Array.from(new Set(logIds.match(/\blog_[A-Za-z0-9_-]+\b/g) ?? []));

  if (ids.length === 0) {
    return "No Composio tool log IDs were provided.";
  }

  const summaries: string[] = [];

  for (const logId of ids.slice(0, 5)) {
    try {
      const log = (await client.logs.tools.retrieve(logId)) as unknown as Record<
        string,
        unknown
      >;
      summaries.push(formatToolLog(logId, log));
    } catch (error) {
      summaries.push(
        [
          `Log ID: ${logId}`,
          "Lookup failed.",
          `Error: ${error instanceof Error ? redactString(error.message) : "unknown error"}`,
        ].join("\n")
      );
    }
  }

  return summaries.join("\n\n---\n\n");
};
