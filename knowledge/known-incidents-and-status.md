# Known Incidents And Status

Before deep troubleshooting, check whether the report matches a known incident, outage, degraded service, or recent platform recovery.

Incident-shaped signals include:

- Many customers reporting the same symptom.
- Mentions of platform down, MCP gateway down, Connect down, For You down, dashboard down, billing page down, login blocked, or API keys not working.
- 5xxs, timeouts, missing tools across multiple users, or all connections disappearing.
- Posts asking for an update, incident response, support availability, refunds, frozen accounts, or security fallout.

Public response pattern:

1. Acknowledge the impact directly.
2. Say whether this appears to match a broader incident or whether you need one confirming detail.
3. Ask for only the highest-value non-secret detail, such as affected surface, timestamp, request ID, org ID, or screenshot.
4. Do not send the user through generic local troubleshooting when symptoms look global.

Never invent incident status. If no verified status is available, say:

```txt
This looks broader than a single local setup, but I do not have a confirmed incident status from here.
```

If the user is upset about slow support, address that directly before technical steps. Do not paste a generic blog-post summary as the only answer.

When private diagnostics are needed, collect:

- Affected product surface: dashboard, Connect, MCP, API, SDK, CLI, billing, or auth.
- Environment and region if known.
- Request ID, trace ID, or timestamp.
- Organization ID or project ID if the user can share it privately.
- Whether multiple users in the same org are affected.

