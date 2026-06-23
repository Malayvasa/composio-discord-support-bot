import { config } from "../config.js";

export type IssueRoute = "auth" | "billing" | "infra" | "diagnostics" | "default";

export interface PrivacyDecision {
  route: IssueRoute;
  requiresPrivateDiagnostics: boolean;
  reasons: string[];
  staffUserIds: string[];
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

export const getConfiguredStaffUserIds = () =>
  unique([
    ...config.defaultStaffUserIds,
    ...config.authStaffUserIds,
    ...config.billingStaffUserIds,
    ...config.infraStaffUserIds,
    ...config.diagnosticsStaffUserIds,
  ]);

export const isConfiguredStaffUser = (userId: string) =>
  getConfiguredStaffUserIds().includes(userId);

const routeStaff = (route: IssueRoute) => {
  switch (route) {
    case "auth":
      return config.authStaffUserIds;
    case "billing":
      return config.billingStaffUserIds;
    case "infra":
      return config.infraStaffUserIds;
    case "diagnostics":
      return config.diagnosticsStaffUserIds;
    case "default":
      return [];
  }
};

export const classifyPrivacy = (message: string): PrivacyDecision => {
  const normalized = message.toLowerCase();
  const reasons: string[] = [];

  const privateChecks: Array<[RegExp, string]> = [
    [/\borg_[a-z0-9_-]+\b/i, "organization ID"],
    [/\buser_[a-z0-9_-]+\b/i, "user ID"],
    [/\bsession[_-][a-z0-9_-]+\b/i, "session identifier"],
    [/\bca_[a-z0-9_-]+\b/i, "connected account ID"],
    [/\bac_[a-z0-9_-]+\b/i, "auth config ID"],
    [/\btrace[_ -]?id\b/i, "trace ID"],
    [/\brequest[_ -]?id\b/i, "request ID"],
    [/\b[a-f0-9]{24,32}\b/i, "trace-like hexadecimal ID"],
    [/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i, "UUID"],
    [/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i, "email address"],
    [/\b(datadog|metabase|logs?|dashboard|database query)\b/i, "private diagnostics request"],
  ];

  for (const [pattern, reason] of privateChecks) {
    if (pattern.test(message)) {
      reasons.push(reason);
    }
  }

  let route: IssueRoute = "default";

  if (/\b(auth|oauth|connected account|connection|token|scope|permission|401|403)\b/i.test(normalized)) {
    route = "auth";
  } else if (/\b(billing|invoice|subscription|payment|stripe|refund|plan)\b/i.test(normalized)) {
    route = "billing";
  } else if (/\b(datadog|logs?|trace|5\d\d|latency|timeout|incident|production|staging)\b/i.test(normalized)) {
    route = "infra";
  } else if (/\b(metabase|dashboard|query|analytics|database|org_|user_|session)\b/i.test(normalized)) {
    route = "diagnostics";
  }

  const requiresPrivateDiagnostics = reasons.length > 0;
  const staffUserIds = unique([
    ...config.defaultStaffUserIds,
    ...routeStaff(route),
  ]);

  return {
    route,
    requiresPrivateDiagnostics,
    reasons,
    staffUserIds,
  };
};
