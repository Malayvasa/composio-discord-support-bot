# Provider Domain Format

Some provider integrations ask for a company domain, workspace slug, subdomain,
or tenant name. These fields usually expect only the short provider-specific
slug, not a full URL.

For Pipedrive, the Company Domain field should be the company subdomain only,
such as `acme`. Do not include `https://`, `http://`, `.pipedrive.com`, or a
full browser URL.

If a Pipedrive request fails with an SSRF or DNS message that says the hostname
`https` could not be resolved, suspect that a full URL was entered where only
the company domain slug was expected. Ask the customer to update the Company
Domain field to the slug-only value and retry the connection or tool call.
