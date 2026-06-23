# Composio Discord Support Bot

An updated Composio example inspired by `ComposioHQ/auri-discord-bot`, focused on customer support.

The bot listens in Discord, triages support requests, reads local Composio runbooks, and uses [Composio Sessions](https://docs.composio.dev/docs/configuring-sessions) to access your support stack.

## What It Demonstrates

- Current Composio Sessions APIs: `composio.create(userId)` and `session.tools()`.
- A support-team identity for internal tools.
- Bring-your-own diagnostics through configurable toolkits such as Datadog and Metabase.
- Runbook-grounded support behavior.
- Discord support workflows: channel replies, DMs, mentions, and escalation summaries.

Customers in Discord do not connect your internal tools. Your support team connects tools for the configured support identity.

## Setup

Install dependencies:

```bash
npm install
```

Create an env file:

```bash
cp .env.example .env
```

Fill in:

```txt
DISCORD_TOKEN=...
COMPOSIO_API_KEY=...
OPENAI_API_KEY=...
```

Choose your support toolkits:

```txt
COMPOSIO_TOOLKITS=github,linear,slack,gmail,datadog,metabase
SUPPORT_SESSION_USER_ID=support-team
```

If your team uses different internal systems, replace the toolkit list with your own Composio toolkit slugs.

## Run

```bash
npm run dev
```

The bot responds to:

- DMs.
- Direct mentions.
- Messages in `SUPPORT_CHANNEL_IDS`, if configured.
- Every guild message when `SUPPORT_CHANNEL_IDS` is empty.

For production servers, set `SUPPORT_CHANNEL_IDS` so the bot only watches support channels.

## Support Flow

1. A customer posts a support issue in Discord.
2. The bot reads recent Discord context.
3. The bot loads runbooks from `knowledge/`.
4. The bot creates or reuses a Composio support session.
5. The agent uses configured tools when diagnostics are needed.
6. The bot replies with a fix, a targeted question, or an escalation bundle.

## Bring Your Own Datadog And Metabase

This repo does not hard-code Composio's internal dashboards or logs.

To use your own diagnostics:

1. Keep `datadog` and `metabase` in `COMPOSIO_TOOLKITS`, or replace them with your internal toolkit slugs.
2. Connect those tools in Composio for `SUPPORT_SESSION_USER_ID`.
3. Edit `knowledge/diagnostics/*.md` with your team's dashboard names, log fields, and escalation rules.

The bot will use the tools exposed by `session.tools()` and the guidance in the runbooks.

## Key Files

- `src/composio/session.ts`: Composio Sessions setup.
- `src/support/agent.ts`: Support agent prompt and AI SDK call.
- `src/discord/listeners.ts`: Discord message handling.
- `knowledge/`: Support and diagnostics runbooks.
- `docs/plans/2026-06-22-customer-support-bot-design.md`: Design note.

## Current Composio Pattern

```ts
const composio = new Composio({ provider: new VercelProvider() });
const session = await composio.create("support-team", {
  toolkits: {
    enable: ["github", "linear", "slack", "datadog", "metabase"],
  },
});
const tools = await session.tools();
```

Use this pattern for new Composio examples. Avoid older tool-router examples unless you are maintaining legacy code.

