# Auth And Connected Accounts

For customer support, separate the Discord customer from the Composio support identity.

- The Discord customer reports the issue.
- The support bot uses the configured support-team Composio user ID.
- Internal observability tools such as Datadog and Metabase should already be connected to that support identity.
- A reported toolkit like `github` or `gmail` usually means the customer's app was calling that Composio toolkit. It does not mean the support bot needs that provider toolkit enabled to diagnose the issue.

If a tool reports missing auth:

1. Tell the operator which toolkit is not connected.
2. Do not ask the Discord customer to connect internal tools.
3. Suggest that an admin connect the toolkit for the support identity.
4. Continue with knowledge-only help if possible.

For customer-owned toolkits, such as a customer's Gmail or GitHub in their own app, ask for:

- The app's Composio user ID.
- Toolkit slug.
- Connected account ID if known.
- Auth config ID only when debugging custom auth.
- Error text and timestamp.

Use Datadog and Metabase to inspect Composio-side execution logs, traces,
connected-account state, and operational history for customer-owned toolkit
failures. Only suggest enabling provider toolkits such as GitHub, Gmail, Slack,
or Linear on the support identity when the support workflow needs to perform
provider actions itself, such as creating an issue or sending a notification.

Before suggesting a fix, classify the auth path:

- Composio-managed OAuth.
- Custom OAuth.
- API key.
- Bearer token.
- Service account.
- S2S OAuth or client credentials.
- MCP runtime auth.
- Dashboard or management API auth.

Ask for the exact surface and client:

- Dashboard, Connect, hosted MCP, custom MCP, SDK, CLI, or REST API.
- Claude Desktop, Claude Code, Codex, Cursor, browser, server, or custom agent.
- Endpoint path, tool slug, or MCP URL shape with secrets removed.

Do not assume that a key working for one endpoint will work for another endpoint. Ask for method, path, API version, auth header name, and key type.

For provider OAuth scope problems:

- Ask which scopes were requested.
- Ask which scopes were granted if the provider exposes that.
- Ask for the sanitized provider error code and request ID.
- Mention admin consent or tenant policy only when the provider or error suggests it.

Never paste OAuth tokens, API keys, or secret headers into Discord.

If debugging uses a customer email, organization ID, connected account ID, auth config ID, request ID, or trace ID, move the investigation to a private staff diagnostics thread before using internal tools.
