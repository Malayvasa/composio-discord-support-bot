# Metabase Diagnostics

Use Metabase for support-safe operational lookups such as account state, session state, connected account status, usage patterns, and historical counts.

Metabase diagnostics must only run in a private staff diagnostics thread. Do not expose private account rows, customer data, or raw query results in public Discord.

Good Metabase questions:

- Does this Composio user ID have a connected account for the toolkit?
- Did this connected account recently fail auth refresh?
- Are there recent tool executions for this session or user?
- Is the issue isolated to a toolkit, auth config, or customer workspace?

Only query the minimum data needed for support. Summarize findings without exposing private customer data.
