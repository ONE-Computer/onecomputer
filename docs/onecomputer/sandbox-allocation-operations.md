# Sandbox allocation operations

The sandbox API treats allocation as a durable control-plane operation, not a
single best-effort HTTP request. This is required because provider creation can
outlive an HTTP client, and retrying a timed-out create can otherwise allocate
two workspaces for one conversation.

## Request contract

`POST /v1/sandboxes` accepts these server-to-server headers:

- `Idempotency-Key`: stable for one conversation lease generation.
- `X-Allocation-Operation-Id`: stable operation identifier for the same request.

Both values are bounded identifiers. The request fingerprint includes the
organization, project, requester, and sandbox name. Reusing either identity
with different request data returns a conflict and never calls the provider.
Legacy callers without the headers receive generated non-replayable identities;
new control-plane callers must always send them.

## Lifecycle

```text
request -> pending receipt -> provider create -> persisted sandbox -> completed
                                  |
                                  +-> unknown (timeout/error; never blind-retry)
```

The operation receipt is persisted before provider dispatch. A successful
response includes the operation and idempotency identities, and the persisted
sandbox row mirrors them so the authenticated list/get paths can reconcile an
ambiguous result. A replay of a completed request returns the same sandbox and
does not call the provider again.

`GET /v1/sandbox-operations/:operationId` returns only bounded lifecycle
metadata (`pending`, `completed`, or `unknown`) and never provider diagnostics,
credentials, or raw upstream bodies. It is scoped to the organization/project
and requester role.

## Security and recovery boundary

An `unknown` receipt is not treated as success or deletion. ONEVibe may recover
only when an authenticated sandbox list/get response carries the exact
operation ID or idempotency key. A generated sandbox name is not an ownership
proof. Provider-side operation persistence and this consumer-side exact-match
rule together prevent duplicate allocation after a timeout.

This is a lifecycle correctness contract for the current development provider;
it does not claim hardware-virtualized microVM isolation. That remains the
separate attestation gate tracked in ONEVibe `ONE-226`.
