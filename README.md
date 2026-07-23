# ONEComputer greenfield

This branch is the clean implementation line for ONEComputer's governed agent
workspace product. It deliberately contains no source, schema, or dependency
copied from the inherited OneCLI fork.

Start with the [Greenfield V2 polishing plan](local-plans/v2/README.md).
Only the first ready issue in [`local-plans/v2/issues/`](local-plans/v2/issues/) may be
implemented at a time.

The [V1 plan and decisions](local-plans/archive/greenfield-v1/) are historical
evidence, not a migration source, active dependency, or rollback plan.

V1 Issue 001 provides the first runnable vertical slice: the selected employee
UI can create, open, restart, stop, and delete a real local KasmVNC workspace
through the owned Control API. See
[`infra/issue-001/README.md`](infra/issue-001/README.md) for the local runbook.

V1 Issue 002 extends that same product slice with a pinned LiteLLM gateway,
workspace-scoped model/MCP access, real readiness, and an in-product connection
test. See [`infra/issue-002/README.md`](infra/issue-002/README.md) and the
[gateway decision](local-plans/archive/greenfield-v1/decisions/ADR-002-litellm-data-plane.md).

The V1 Gate C vertical slice adds a real governed destructive-operation
journey: ONEComputer persists and hashes the exact request, records a signed
local-fixture decision, issues one execution lease, calls only the approved MCP
tool through a one-time LiteLLM key, and displays the resulting receipt. See
[`ADR-003`](local-plans/archive/greenfield-v1/decisions/ADR-003-governed-operation-slice.md).
