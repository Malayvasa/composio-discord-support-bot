# Sessions Debugging

When a customer reports a Composio issue, identify which layer failed:

1. Session creation: `composio.create(userId, options)` fails or returns unexpected configuration.
2. Tool discovery: the agent cannot find a relevant toolkit or tool.
3. Authentication: the toolkit needs a connected account or the wrong account is selected.
4. Tool execution: the tool is called but the provider API rejects or errors.
5. Provider integration: the AI SDK, model provider, or agent loop failed before or after the tool call.

Ask for these identifiers when they are missing:

- Environment: local, preview, staging, production.
- Toolkit slug and tool slug.
- Composio user ID used for the session.
- Session ID if available.
- Connected account ID if available.
- Request ID or trace ID.
- Exact error text.
- Time window with timezone.

These are helpful clues, not required form fields. If the user provides only an org ID or only an email, use it when it helps and ask for the smallest extra clue needed for the next diagnostic step.

Interpret common statuses:

- 400: likely malformed input, missing required field, or unsupported option.
- 401: missing or invalid credential.
- 403: authenticated but missing permission, scope, or policy access.
- 404: wrong route, wrong environment, disabled feature, or stale docs.
- 429: rate limit or quota.
- 5xx: service or provider failure. Check logs and escalate if production impact exists.

Prefer narrow diagnostic searches by request ID, trace ID, user ID, session ID, connected account ID, or short time window.
