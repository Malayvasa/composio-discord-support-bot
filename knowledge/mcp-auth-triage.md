# MCP And Auth Triage

For MCP, OAuth, API key, and connected-account issues, identify the exact surface before giving fixes.

Ask or infer these first:

- Product surface: hosted MCP, Connect MCP, custom MCP, dashboard, SDK, CLI, or direct REST API.
- Client: Claude Desktop, Claude Code, Codex, Cursor, custom agent, browser, or server.
- Auth mode: Composio-managed OAuth, custom OAuth, API key, bearer token, service account, or S2S OAuth.
- Identifier type: project ID, org ID, user ID, entity ID, connected account ID, auth config ID, or MCP server ID.
- Endpoint or tool slug involved.
- Exact status code and sanitized error body.

Do not collapse these cases:

- A connected account can be active while a provider API still returns 403 due to missing scopes or tenant policy.
- A management API key is not always the same credential as an MCP runtime key.
- Hosted Connect MCP behavior can differ from custom MCP server URLs.
- OAuth consent success does not prove the required provider scopes were requested or granted.
- A dashboard login issue is different from a tool execution issue.

Common decision points:

- 401: check key type, header name, expired auth, wrong MCP URL, or unauthenticated client session.
- 403: check provider scopes, tenant/admin consent, feature entitlement, or org/project role.
- 404: check stale endpoint, wrong API version, wrong region/base URL, disabled feature, or docs mismatch.
- Empty tools: check MCP client restart, tool discovery, connected toolkit, action scopes, and whether the account is connected under the expected user/entity.
- OAuth blocked by provider: check app verification, consent screen, requested scopes, and whether the customer uses managed or custom OAuth.

For Microsoft or Google scope failures, ask for the scopes requested and the sanitized provider error code. Do not ask for tokens.

For Composio endpoint mismatches, ask for method, path, API version, auth header name, and key type. Do not guess that two endpoints accept the same credential.

