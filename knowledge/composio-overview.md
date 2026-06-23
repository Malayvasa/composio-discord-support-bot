# Composio Overview

Composio gives an AI agent controlled access to external tools. A support bot should explain these concepts with current terminology:

- A session is the runtime scope for one user or service identity.
- A toolkit is an app or integration surface, such as GitHub, Linear, Slack, Datadog, or Metabase.
- A tool is a specific action inside a toolkit.
- A connected account stores credentials for a toolkit for a specific user ID.
- An auth config is the authentication blueprint for a toolkit.

For this example, Discord customers are not the Composio users who connect internal tools. The configured support identity, such as `support-team`, owns the connected accounts that let the bot investigate issues.

Use current Sessions APIs:

```ts
const session = await composio.create("support-team", {
  toolkits: { enable: ["github", "linear", "slack", "datadog", "metabase"] },
});
const tools = await session.tools();
```

Do not use old tool-router APIs in this example.

