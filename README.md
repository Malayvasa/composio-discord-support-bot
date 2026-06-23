# Composio Discord Support Bot

An updated Composio example inspired by `ComposioHQ/auri-discord-bot`, focused on customer support.

The bot listens in Discord, triages support requests, reads local Composio runbooks, and uses [Composio Sessions](https://docs.composio.dev/docs/configuring-sessions) to access your support stack.

## What It Demonstrates

- Current Composio Sessions APIs: `composio.create(userId)` and `session.tools()`.
- A support-team identity for internal tools.
- Bring-your-own diagnostics through configurable toolkits such as Datadog and Metabase.
- Runbook-grounded support behavior.
- Discord support workflows: public triage, private diagnostics threads, staff routing, and escalation summaries.

Customers in Discord do not connect your internal tools. Your support team connects tools for the configured support identity.

Private diagnostics never run directly in public channels. If a request includes private identifiers or asks for internal diagnostics, the bot creates a private staff thread, adds the configured staff users, and only then uses Composio tools.

File attachments are treated as private by default. The bot opens a private staff thread before reading small text-like files or summarizing attachment context.

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

Configure who gets added to private diagnostics threads:

```txt
DEFAULT_STAFF_USER_IDS=111111111111111111,222222222222222222
AUTH_STAFF_USER_IDS=333333333333333333
BILLING_STAFF_USER_IDS=444444444444444444
INFRA_STAFF_USER_IDS=555555555555555555
DIAGNOSTICS_STAFF_USER_IDS=666666666666666666
PRIVATE_THREAD_NAME_PREFIX=support-debug
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

The bot needs Discord permissions to send messages, create private threads, and add members to private threads. If it cannot create the thread or add the right staff users, it fails closed and does not run diagnostics. Follow-up commands inside private diagnostics threads only run for configured staff users.

### Discord Forum Channels

`SUPPORT_CHANNEL_IDS` can include Discord forum channel IDs. The bot will respond inside forum posts under that forum.

Discord forum posts are public threads, and Discord cannot convert them into private threads or create private threads inside them. If private diagnostics are needed from a forum post, configure a normal text channel where private diagnostics threads should be created:

```txt
SUPPORT_CHANNEL_IDS=1268871288156323901
SUPPORT_FORUM_AUTHOR_IDS=417699705330335745
PRIVATE_DIAGNOSTICS_CHANNEL_ID=1518786626736881694
```

`SUPPORT_FORUM_AUTHOR_IDS` is optional. It is useful for testing because it limits auto-responses to forum posts created by specific Discord users.

## Support Flow

1. A customer posts a support issue in Discord.
2. The bot reads recent Discord context.
3. The bot loads runbooks from `knowledge/`.
4. If the request is public-safe, the bot responds without internal diagnostic tools.
5. If the request includes private identifiers or diagnostics, the bot creates a private staff thread and adds routed staff users.
6. Inside the private thread, the bot creates or reuses a Composio support session.
7. The private agent uses configured tools when diagnostics are needed.
8. The public channel only receives safe acknowledgements or sanitized follow-ups.

Private-thread triggers include organization IDs, user IDs, session IDs, connected account IDs, auth config IDs, request IDs, trace IDs, UUIDs, email addresses, Datadog, Metabase, logs, dashboards, and database queries.
File attachments also trigger a private thread.

Private thread names use the configured prefix, routing category, and the best available debug clue, such as `support-debug-account-ok-waou8bjo73ly` or `support-debug-infra-pr-xtim-6kfdiir`.

## File Attachments

The bot supports Discord attachments in support messages:

- In public channels, attachments always move the request into a private diagnostics thread.
- In private threads, staff can attach screenshots, logs, JSON, CSV, Markdown, or text files.
- Small text-like files are fetched and passed to the private agent for summarization.
- Large files and binary files are preserved as metadata and Discord links.

Tune limits with:

```txt
ATTACHMENT_MAX_FILES=5
ATTACHMENT_MAX_BYTES=1000000
ATTACHMENT_TEXT_MAX_CHARS=12000
```

## Optional Debug Fields

Users can include structured clues in any support message:

```txt
@project_id: pr_XTim_6KFDiIR
@org_id: ok_WAOU8bjO73lY
@org_member_email: malay@composio.dev
@user_id: 04570f62-4d8d-46e2-b5f3-3dd1b3972495
@environment: production
@time_window: last 2 hours
@toolkit: github
@tool: GITHUB_CREATE_ISSUE
@error: 403 permission denied
```

These fields are optional. The bot extracts what is present, investigates when it has enough signal, and asks for only the missing clue it needs next. See `knowledge/debug-fields.md` for supported fields and where users can find them.

## Staff Routing

Routing is intentionally simple and env-based for the public example:

- Auth, OAuth, connected account, token, scope, 401, or 403 issues route to `AUTH_STAFF_USER_IDS`.
- Billing, invoice, subscription, payment, Stripe, refund, or plan issues route to `BILLING_STAFF_USER_IDS`.
- Datadog, logs, traces, 5xx, latency, timeout, incident, production, or staging issues route to `INFRA_STAFF_USER_IDS`.
- Metabase, dashboard, query, analytics, org, user, or session lookups route to `DIAGNOSTICS_STAFF_USER_IDS`.
- Every private thread also includes `DEFAULT_STAFF_USER_IDS`.

If no users resolve for a route, diagnostics do not run.

## Bring Your Own Datadog And Metabase

This repo does not hard-code Composio's internal dashboards or logs.

To use your own diagnostics:

1. Keep `datadog` and `metabase` in `COMPOSIO_TOOLKITS`, or replace them with your internal toolkit slugs.
2. Connect those tools in Composio for `SUPPORT_SESSION_USER_ID`.
3. Edit `knowledge/diagnostics/*.md` with your team's dashboard names, log fields, and escalation rules.
4. Configure staff user IDs so private investigations reach the right people.

The bot will use the tools exposed by `session.tools()` and the guidance in the runbooks.

## Key Files

- `src/composio/session.ts`: Composio Sessions setup.
- `src/support/agent.ts`: Support agent prompt and AI SDK call.
- `src/support/debug-fields.ts`: Optional `@key: value` debug-field parser.
- `src/support/privacy.ts`: Private diagnostics classifier and staff routing.
- `src/discord/listeners.ts`: Discord message handling.
- `src/discord/private-thread.ts`: Private thread creation and staff member adds.
- `knowledge/`: Support and diagnostics runbooks.
- `docs/plans/2026-06-22-customer-support-bot-design.md`: Design note.
- `docs/plans/2026-06-22-private-diagnostics-threads-design.md`: Private diagnostics design note.

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
