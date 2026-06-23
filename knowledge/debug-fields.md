# Optional Debug Fields

Users can include structured debug clues in any support message. These fields are optional. Accept partial context and ask for more only when it would materially improve the next diagnostic step.

Example:

```txt
@project_id: pr_XTim_6KFDiIR
@org_id: ok_WAOU8bjO73lY
@org_member_email: malay@composio.dev
@user_id: 04570f62-4d8d-46e2-b5f3-3dd1b3972495
@environment: production
@time_window: last 2 hours
@toolkit: github
@tool: GITHUB_CREATE_ISSUE
@error: 403 permission denied
```

Supported clues:

- `@project_id`: Composio project ID. Useful for project-scoped API keys, dashboards, and usage.
- `@org_id`: Composio organization ID. Useful for workspace/account lookups.
- `@org_member_email`: Reporting member email. Useful when the user ID is unknown.
- `@user_id`: App/user/session owner ID. Useful for session and connected-account lookups.
- `@environment`: production, staging, preview, local, or sandbox.
- `@time_window`: A bounded window like `last 30 minutes` or `2026-06-23 01:00-01:30 UTC`.
- `@toolkit`: Toolkit slug, such as `github`, `gmail`, `datadog`, or `metabase`.
- `@tool`: Tool slug, such as `GITHUB_CREATE_ISSUE`.
- `@connected_account_id`: Connected account ID, usually starts with `ca_`.
- `@session_id`: Composio session ID.
- `@request_id`: API/log request ID.
- `@trace_id`: Datadog or service trace ID.
- `@route`: API route or endpoint.
- `@error`: Exact error text or status.

Where users can find clues:

- Request ID: API error response, response headers, SDK debug logs, or server logs.
- Trace ID: Datadog APM trace view, log correlation fields, or service error output.
- Project ID: Composio dashboard project URL/settings.
- Org ID: Composio dashboard org/workspace settings or URL.
- User ID: The app's user identifier passed to `composio.create(userId)`.
- Connected account ID: Composio dashboard connected accounts page or tool error details.
- Toolkit/tool slug: SDK code, tool call logs, or Composio tool execution output.
- Time window: User report timestamp, incident timeline, or log timestamp.

When context is missing, ask for at most three focused items and explain where to find them. Do not block on a complete form.

