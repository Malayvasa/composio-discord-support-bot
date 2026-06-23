# Customer Support Discord Bot Design

## Goal

Build an updated Composio example inspired by `ComposioHQ/auri-discord-bot`, but focused on customer support instead of a general Discord assistant.

The bot should receive support requests in Discord, use Composio Sessions to access company support and diagnostics tools, consult repo-local knowledge, and return concise answers or escalation summaries.

## Product Shape

The bot acts as a customer support operator:

- Triage support messages from Discord channels, threads, mentions, and DMs.
- Answer common Composio questions from embedded knowledge.
- Ask for missing debugging identifiers such as request ID, trace ID, toolkit slug, user ID, environment, or timeframe.
- Use Composio Sessions to access configured support tools like GitHub, Linear, Slack, Gmail, Datadog, Metabase, and internal log tools.
- Escalate with a clean evidence bundle when the issue needs a human or engineering owner.

Customers do not authenticate internal tools. The bot uses a support-team identity, configured by the operator, to access company systems.

## Architecture

The example uses Bun or Node-compatible TypeScript:

- `src/index.ts` starts the Discord client and a small health server.
- `src/config.ts` validates required environment variables.
- `src/composio/session.ts` owns the Composio client and creates or reuses a support session with `composio.create(userId, options)`.
- `src/support/agent.ts` runs the Vercel AI SDK with `session.tools()`.
- `src/support/knowledge.ts` loads markdown guidance from `knowledge/`.
- `src/discord/listeners.ts` decides when the bot should respond and builds Discord conversation context.
- `knowledge/` stores Composio and support debugging knowledge.

## Composio Pattern

Use current Sessions APIs:

```ts
const composio = new Composio({ provider: new VercelProvider() });
const session = await composio.create("support-team", {
  toolkits: {
    enable: ["github", "linear", "slack", "gmail", "datadog", "metabase"],
  },
});
const tools = await session.tools();
```

Operators can override the toolkit list with `COMPOSIO_TOOLKITS`. The example should not use old tool-router APIs or require users to manually create auth configs before running.

## Debugging Brain

The bot's behavior is driven by knowledge, not just tool access. It should know core Composio concepts:

- Sessions
- Toolkits and tools
- Connected accounts
- Auth configs
- Tool discovery
- Provider integrations
- Request IDs and trace IDs

For diagnostics, the bot should preserve evidence:

- Customer Discord message link
- Environment
- Toolkit and tool slug
- User ID or session ID when available
- Connected account ID when available
- Request ID and trace ID
- HTTP status and error text
- Time window
- Log or dashboard evidence

## Error Handling

The bot should:

- Ask for missing identifiers before searching broad logs.
- Avoid exposing secrets, raw tokens, or unrelated customer data.
- Tell the user when support tools are not connected or unavailable.
- Fall back to knowledge-based guidance when tools fail.
- Escalate when there is a production 5xx, security concern, billing impact, customer-blocking auth failure, or repeated incident pattern.
- Run private diagnostics only in private Discord threads with the right staff users added.
- Fail closed if a private diagnostics thread cannot be created or routed.

## Testing

The first version should pass TypeScript checking. Runtime testing requires real Discord, model, and Composio credentials.
