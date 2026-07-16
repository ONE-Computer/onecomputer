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

## Controlled failure-injection proof

The development provider has an explicit, non-production-only chaos hook for
testing the ambiguous response boundary. With both
`ONECOMPUTER_TEST_MODE=1` and
`ONECOMPUTER_TEST_INJECT_ALLOCATION_RESPONSE_FAILURE_ONCE=1`, the first
allocation persists its sandbox and completed receipt, starts asynchronous
bootstrap, then returns a generic HTTP 504 once. The hook is inert in
`NODE_ENV=production`, exposes no provider error body, and is not an
availability or authorization mechanism.

Against that explicitly configured development provider, run the ONEVibe
recovery harness:

```sh
npm run e2e:onecomputer-recovery
```

The expected proof is: first turn fails with a durable `unknown` lease, the
follow-up adopts the exact operation/key-labelled sandbox without a second
create, the same conversation completes, and explicit release leaves no
provider row. This test hook must be disabled and removed from deployment
environment before any production rollout.

## Security and recovery boundary

An `unknown` receipt is not treated as success or deletion. ONEVibe may recover
only when an authenticated sandbox list/get response carries the exact
operation ID or idempotency key. A generated sandbox name is not an ownership
proof. Provider-side operation persistence and this consumer-side exact-match
rule together prevent duplicate allocation after a timeout.

This is a lifecycle correctness contract for the current development provider;
it does not claim hardware-virtualized microVM isolation. That remains the
separate attestation gate tracked in ONEVibe `ONE-226`.

## Fail-closed production switch

Set `ONECOMPUTER_REQUIRE_ATTESTED_ISOLATION=1` on a control-plane deployment
only when it must refuse every provider that lacks a signed isolation
attestation. The current `kasm-local` and `daytona` adapters are deliberately
rejected under this switch. The default remains unset for the development POC;
the switch does not manufacture attestation or convert a container into a
microVM.
