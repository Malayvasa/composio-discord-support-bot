# Datadog Diagnostics

Use Datadog for production health, traces, service errors, latency, and incident checks.

Datadog is internal Composio observability. It can help diagnose failures for
any customer-reported toolkit, such as GitHub or Gmail, by searching Composio
service logs and traces. The reported `@toolkit` field is the failing customer
toolkit, not a requirement to enable that toolkit for the support bot.

Datadog diagnostics must only run in a private staff diagnostics thread. Public replies can say that staff is investigating, but should not expose internal metrics, trace contents, or service details that are not safe for customers.

Good Datadog searches include:

- Request ID.
- Trace ID.
- Service name.
- Route or endpoint.
- Toolkit slug.
- Status code.
- Time window.

Check:

- Error spikes around the reported time.
- Whether failures are isolated to one customer, toolkit, provider, or service.
- Recent deploy version or environment changes.
- Latency, timeout, and rate-limit patterns.

Escalate when there are production 5xx spikes, sustained latency, widespread auth failures, data integrity risk, or security concerns.
