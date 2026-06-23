export type DebugFieldKey =
  | "project_id"
  | "org_id"
  | "org_member_email"
  | "user_id"
  | "environment"
  | "time_window"
  | "toolkit"
  | "tool"
  | "connected_account_id"
  | "session_id"
  | "request_id"
  | "log_id"
  | "trace_id"
  | "route"
  | "error";

export type DebugFields = Partial<Record<DebugFieldKey, string>>;

const aliases: Record<string, DebugFieldKey> = {
  project: "project_id",
  project_id: "project_id",
  org: "org_id",
  org_id: "org_id",
  organization_id: "org_id",
  org_member_email: "org_member_email",
  email: "org_member_email",
  user: "user_id",
  user_id: "user_id",
  environment: "environment",
  env: "environment",
  time_window: "time_window",
  window: "time_window",
  timeframe: "time_window",
  toolkit: "toolkit",
  tool: "tool",
  tool_slug: "tool",
  connected_account: "connected_account_id",
  connected_account_id: "connected_account_id",
  connectedaccountid: "connected_account_id",
  connection_id: "connected_account_id",
  connectionid: "connected_account_id",
  ca_id: "connected_account_id",
  session_id: "session_id",
  request_id: "request_id",
  req_id: "request_id",
  log_id: "log_id",
  logid: "log_id",
  action_log_id: "log_id",
  trace_id: "trace_id",
  route: "route",
  endpoint: "route",
  error: "error",
};

const normalizeKey = (key: string): DebugFieldKey | undefined => {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[\s-]+/g, "_");

  return aliases[normalized];
};

export const parseDebugFields = (message: string): DebugFields => {
  const fields: DebugFields = {};

  for (const line of message.split(/\r?\n/)) {
    const match =
      line.match(/(?:^|[\s:])@([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*$/) ??
      line.match(/(?:^|[\s:])@([a-zA-Z0-9_-]+)\s+(\S+)\s*$/);

    if (!match) {
      continue;
    }

    const key = normalizeKey(match[1]);

    if (!key) {
      continue;
    }

    fields[key] = match[2].trim();
  }

  if (!fields.request_id) {
    const requestIdBlock = message.match(
      /request ids?:\s*([\s\S]*?)(?:\n\s*\n|$)/i
    );
    const requestIds = Array.from(
      (requestIdBlock?.[1] ?? message).matchAll(
        /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi
      )
    ).map(([requestId]) => requestId);

    if (requestIds.length > 0) {
      fields.request_id = Array.from(new Set(requestIds)).join(", ");
    }
  }

  if (!fields.log_id) {
    const logIds = Array.from(message.matchAll(/\blog_[A-Za-z0-9_-]+\b/g)).map(
      ([logId]) => logId
    );

    if (logIds.length > 0) {
      fields.log_id = Array.from(new Set(logIds)).join(", ");
    }
  }

  if (!fields.connected_account_id) {
    const connectedAccountIds = Array.from(
      message.matchAll(/\bca_[A-Za-z0-9_-]+\b/g)
    ).map(([connectedAccountId]) => connectedAccountId);

    if (connectedAccountIds.length > 0) {
      fields.connected_account_id = Array.from(
        new Set(connectedAccountIds)
      ).join(", ");
    }
  }

  if (!fields.toolkit) {
    const toolingArea = message.match(/^\s*Tooling area:\s*([^/\n]+)/im);
    const toolkitName = toolingArea?.[1]
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (toolkitName) {
      fields.toolkit = toolkitName;
    }
  }

  if (!fields.error) {
    const status = message.match(/^\s*Status:\s*(\d{3})\s*$/im)?.[1];
    const code = message.match(/^\s*Code:\s*([^\n]+)\s*$/im)?.[1]?.trim();
    const slug = message.match(/^\s*Slug:\s*([^\n]+)\s*$/im)?.[1]?.trim();
    const firstQuotedError = Array.from(
      message.matchAll(/"([^"\n]*(?:SSRF|blocked|failed|forbidden|unauthorized|protection|invalid|denied)[^"\n]*)"/gi)
    )
      .map((match) => match[1]?.trim())
      .find((value) => value && value.toLowerCase() !== "error");

    const errorParts = [
      status ? `status ${status}` : "",
      code ? `code ${code}` : "",
      slug ? `slug ${slug}` : "",
      firstQuotedError ?? "",
    ].filter(Boolean);

    if (errorParts.length > 0) {
      fields.error = errorParts.join("; ");
    }
  }

  return fields;
};

export const formatDebugFields = (fields: DebugFields) => {
  const entries = Object.entries(fields).filter(([, value]) => value);

  if (entries.length === 0) {
    return "No structured @debug fields provided.";
  }

  return entries.map(([key, value]) => `@${key}: ${value}`).join("\n");
};
