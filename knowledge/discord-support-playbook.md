# Discord Support Playbook

Triage every message into one of these buckets:

- How-to question: answer from runbooks and docs, then offer a next step.
- Setup issue: ask for environment, package versions, toolkit list, and code snippet.
- Auth issue: ask for user ID, toolkit, connected account ID, status, and exact error.
- Tool execution issue: ask for tool slug, input shape, request ID, trace ID, and timestamp.
- Incident: collect impact, status codes, route, environment, and time window.
- Feature request: summarize desired outcome and create or suggest a ticket.

Debug info format:

- Treat `@key: value` lines as optional clues, not required fields.
- Start investigating with partial context when there is enough signal.
- Ask for more only when the next step needs it.
- Tell the user where to find the missing clue.
- Prefer a bounded time window or request/trace ID before broad log searches.

Privacy rule:

- Public Discord is for triage and safe guidance only.
- Private identifiers and internal diagnostics require a private staff thread.
- Do not run Datadog, Metabase, logs, dashboards, or internal account lookups in public.
- If a private thread cannot be created or the right staff cannot be added, stop and fail closed.

Private-thread triggers include:

- Organization IDs.
- User IDs.
- Session IDs.
- Connected account IDs.
- Auth config IDs.
- Request IDs.
- Trace IDs.
- Email addresses.
- Datadog, Metabase, logs, dashboards, or database queries.

First response pattern:

1. State what you think is happening.
2. Give the next action or answer.
3. Ask for missing evidence only if needed.

Escalation summary format:

```txt
Issue:
Impact:
Customer / Discord link:
Environment:
Toolkit / tool:
User ID / session ID:
Connected account:
Request ID / trace ID:
Time window:
What was checked:
Likely owner:
```
