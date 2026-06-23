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
  connected_account_id: "connected_account_id",
  ca_id: "connected_account_id",
  session_id: "session_id",
  request_id: "request_id",
  req_id: "request_id",
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
    const match = line.match(/^\s*@([a-zA-Z0-9_\-\s]+)\s*:\s*(.+?)\s*$/);

    if (!match) {
      continue;
    }

    const key = normalizeKey(match[1]);

    if (!key) {
      continue;
    }

    fields[key] = match[2].trim();
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

