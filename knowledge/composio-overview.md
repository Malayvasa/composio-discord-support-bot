# Composio Overview

Composio gives an AI agent controlled access to external tools. A support bot should explain these concepts with current terminology:

- A session is the runtime scope for one user or service identity.
- A toolkit is an app or integration surface, such as Composio Search, Datadog, Metabase, GitHub, Linear, Slack, or Gmail.
- A tool is a specific action inside a toolkit.
- A connected account stores credentials for a toolkit for a specific user ID.
- An auth config is the authentication blueprint for a toolkit.

For this example, Discord customers are not the Composio users who connect internal tools. The configured support identity, such as `support-team`, owns the connected accounts that let the bot investigate issues.

Use current Sessions APIs:

```ts
const session = await composio.create("support-team", {
  toolkits: { enable: ["composio_search", "datadog", "metabase"] },
});
const tools = await session.tools();
```

Keep the public example default small. Add escalation toolkits such as GitHub, Linear, Slack, or Gmail only when the support workflow needs to create tickets, notify staff, or inspect support email context.

Do not use old tool-router APIs in this example.
