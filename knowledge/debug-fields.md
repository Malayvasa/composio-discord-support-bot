# Optional Debug Fields

Users can include structured debug clues in any support message. These fields are optional. Accept partial context and ask for more only when it would materially improve the next diagnostic step.

The bot also extracts common free-form clues, such as a `Request IDs:` block,
`Tooling area: Pipedrive / ...`, `Status: 400`, `Code: ...`, and `Slug: ...`.
Structured fields are preferred, but customers do not need to rewrite a natural
support report into a form.

Example:

```txt
@project_id: pr_your_project_id
@org_id: org_your_workspace_id
@org_member_email: user@example.com
@user_id: user_123
@environment: production
@time_window: last 2 hours
@toolkit: datadog
@tool: DATADOG_SEARCH_LOGS
@error: 403 permission denied
```

Supported clues:

- `@project_id`: Composio project ID. Useful for project-scoped API keys, dashboards, and usage.
- `@org_id`: Composio organization ID. Useful for workspace/account lookups.
- `@org_member_email`: Reporting member email. Useful when the user ID is unknown.
- `@user_id`: App/user/session owner ID. Useful for session and connected-account lookups.
- `@environment`: production, staging, preview, local, or sandbox.
- `@time_window`: A bounded window like `last 30 minutes` or `2026-06-23 01:00-01:30 UTC`.
- `@toolkit`: Toolkit slug, such as `datadog`, `metabase`, or another support toolkit you enabled.
- `@tool`: Tool slug, such as `DATADOG_SEARCH_LOGS`.
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
