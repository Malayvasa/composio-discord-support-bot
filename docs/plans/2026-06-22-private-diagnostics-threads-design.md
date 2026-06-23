# Private Diagnostics Threads Design

## Problem

Public Discord support channels are not safe places to run diagnostics against organization IDs, user IDs, session IDs, connected account IDs, request IDs, trace IDs, logs, dashboards, or customer account data.

If the bot receives a debugging request in public Discord, it must not query Datadog, Metabase, logs, or other private systems and then reply in public.

## Decision

Diagnostics are private-thread mandatory.

When a support request needs private diagnostics, the bot must:

1. Classify the issue area.
2. Resolve the right staff users from env-based routing.
3. Create a private Discord thread.
4. Add the resolved staff users to the thread.
5. Post the original customer context into the thread.
6. Run Composio diagnostics only inside that private thread.
7. Reply publicly only with a safe acknowledgement.

If private thread creation or staff routing fails, the bot must fail closed and not run diagnostics.

## Public Mode

Public channels and customer DMs are safe for:

- General setup guidance.
- Clarifying questions.
- Documentation-based support.
- Sanitized status updates.

Public mode must not receive Composio diagnostic tools. It can still use the local knowledge.

## Private Mode

Private diagnostics threads are safe for:

- Datadog, Metabase, log, and internal support-tool queries.
- Investigation notes.
- Evidence bundles for staff.

Private responses must still avoid secrets, raw tokens, and unrelated customer data.

## Routing

The public example uses env-based staff routing:

- `DEFAULT_STAFF_USER_IDS`
- `AUTH_STAFF_USER_IDS`
- `BILLING_STAFF_USER_IDS`
- `INFRA_STAFF_USER_IDS`
- `DIAGNOSTICS_STAFF_USER_IDS`

The bot classifies the customer message into a simple route and adds the matching users plus default staff. If no staff users resolve, diagnostics do not run.

Follow-up commands inside private diagnostics threads should only run for configured staff user IDs.

## Discord Requirements

The bot needs permissions to:

- View the support channel.
- Send messages.
- Create private threads.
- Manage threads or add members to private threads.

Private thread creation is mandatory. The example intentionally does not fall back to public diagnostics or broad staff channels.
