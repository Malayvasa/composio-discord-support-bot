# Metabase Diagnostics

Use Metabase for support-safe operational lookups such as account state, session state, connected account status, usage patterns, and historical counts.

Metabase is internal Composio support analytics. It can help diagnose failures
for any customer-reported toolkit by checking Composio-side account and
execution state. The reported `@toolkit` field is the failing customer toolkit,
not a requirement to enable that toolkit for the support bot.

Metabase diagnostics must only run in a private support thread with the customer and configured staff. Do not expose private account rows, unrelated customer data, or raw query results in Discord; summarize only the relevant customer-safe finding.

Good Metabase questions:

- Does this Composio user ID have a connected account for the toolkit?
- Did this connected account recently fail auth refresh?
- Are there recent tool executions for this session or user?
- Is the issue isolated to a toolkit, auth config, or customer workspace?

Only query the minimum data needed for support. Summarize findings without exposing private customer data.
