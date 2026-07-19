# ONEComputer greenfield

This branch is the clean implementation line for ONEComputer's governed agent
workspace product. It deliberately contains no source, schema, or dependency
copied from the inherited OneCLI fork.

Start with [`local-plans/v4-greenfield-governed-agent-platform.md`](local-plans/v4-greenfield-governed-agent-platform.md).
Only the first ready issue in [`local-plans/issues/`](local-plans/issues/) may be
implemented at a time.

The previous repository state is research material, not a migration source or
rollback dependency.

Issue 001 now provides the first runnable vertical slice: the selected employee
UI can create, open, restart, stop, and delete a real local KasmVNC workspace
through the owned Control API. See
[`infra/issue-001/README.md`](infra/issue-001/README.md) for the local runbook.

Issue 002 extends that same product slice with a pinned LiteLLM gateway,
workspace-scoped model/MCP access, real readiness, and an in-product connection
test. See [`infra/issue-002/README.md`](infra/issue-002/README.md) and the
[gateway decision](local-plans/decisions/ADR-002-litellm-data-plane.md).

The current Gate C vertical slice adds a real governed destructive-operation
journey: ONEComputer persists and hashes the exact request, records a signed
local-fixture decision, issues one execution lease, calls only the approved MCP
tool through a one-time LiteLLM key, and displays the resulting receipt. See
[`local-plans/decisions/ADR-003-governed-operation-slice.md`](local-plans/decisions/ADR-003-governed-operation-slice.md).
