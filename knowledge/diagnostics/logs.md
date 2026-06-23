# Logs Diagnostics

Use logs when a customer provides a request ID, trace ID, route, user ID, or tight time window.

Look for:

- HTTP status.
- Error message.
- Service name.
- Environment.
- Version or commit SHA.
- Latency and timeout.
- Upstream provider response.
- Request ID and trace ID correlation.

If only a vague report is available, ask for more detail before searching broad logs.

Do not paste raw log lines that include secrets, credentials, tokens, customer payloads, or unrelated tenant data. Summarize the relevant finding.

