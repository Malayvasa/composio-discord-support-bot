# Auth And Connected Accounts

For customer support, separate the Discord customer from the Composio support identity.

- The Discord customer reports the issue.
- The support bot uses the configured support-team Composio user ID.
- Internal tools such as Datadog, Metabase, Slack, Linear, and GitHub should already be connected to that support identity.

If a tool reports missing auth:

1. Tell the operator which toolkit is not connected.
2. Do not ask the Discord customer to connect internal tools.
3. Suggest that an admin connect the toolkit for the support identity.
4. Continue with runbook-only help if possible.

For customer-owned toolkits, such as a customer's Gmail or GitHub in their own app, ask for:

- The app's Composio user ID.
- Toolkit slug.
- Connected account ID if known.
- Auth config ID only when debugging custom auth.
- Error text and timestamp.

Never paste OAuth tokens, API keys, or secret headers into Discord.

