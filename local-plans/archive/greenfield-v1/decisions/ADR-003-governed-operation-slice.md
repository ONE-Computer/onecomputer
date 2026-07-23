# ADR-003: Control owns governed operation binding and execution leases

Status: accepted for local fixture verification

Date: 2026-07-19

## Decision

ONEComputer Control and its owned PostgreSQL database create the authoritative
operation before any protected execution begins. The canonical operation
envelope binds the tenant, subject, workspace, audience, capability, MCP
server, tool, argument schema, exact arguments, nonce, and expiry. Its SHA-256
digest is the immutable approval and execution binding.

An approval is valid only when its signed envelope verifies against that same
binding. Control then grants at most one execution lease using a compare-and-
swap transition. The LiteLLM adapter creates a short-lived key scoped to the
exact MCP server and tool, resolves the selected server identifier, executes
the call, revokes the key, and returns a receipt for Control to persist.

## Fixture boundary

The browser approval button and local HMAC signer are test fixtures. They prove
the operation state machine and binding expected from a future trusted
approval transport, but they are not an enterprise approval authority or a
substitute for OpenVTC.

## Consequences

- LiteLLM is an execution data plane, not the policy or approval authority.
- Mutating operation status without a verified approval record cannot create
  an execution lease.
- Concurrent approval or execution retries produce at most one upstream call.
- Expired pending operations and abandoned execution leases terminate closed.
- Gate C stays in verification until data-driven capability and policy records,
  cancellation or outbox behavior, and the remaining outage and restart
  evidence are complete.
