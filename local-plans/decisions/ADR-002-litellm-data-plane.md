# ADR-002: LiteLLM is the model and MCP data plane

Status: accepted

Date: 2026-07-19

## Decision

Adopt pinned LiteLLM as ONEComputer's model and MCP data plane. Keep the
ONEComputer Control API and owned PostgreSQL as the sole authority for identity,
capability policy, governed operations, approvals, execution leases, and
evidence.

Use the narrow `@onecomputer/litellm-adapter` package for workspace virtual-key
lifecycle, readiness probes, and normalized errors. A workspace receives only
its short-lived scoped key. The LiteLLM master key remains in LiteLLM and the
private Control service.

## Why

The pinned runtime proved OpenAI and Anthropic normal/streaming routes, bounded
model discovery, deny-by-default MCP discovery, per-server and per-tool
permissions, gateway-side tool execution, and revocation. The destructive tool
negative case reached the upstream zero times.

LiteLLM did not prove ONEComputer's durable operation reference, approval
binding, safe resume, or exact fail-closed policy callback. Those semantics do
not belong in a vendor UI, client, or upstream MCP server, so they remain owned
Control functionality.

## Consequences

- ADR-004 defines the separate user, agent, and workspace identities used for
  delegated Microsoft OAuth and per-agent gateway policy.
- Continue to Issue 003 after human acceptance of this partial decision.
- Issues 003–005 own durable operations, policy decisions, approval fixtures,
  single execution leases, and the full protected-failure matrix.
- Before active Issue 008 closes, requalify the pinned LiteLLM pre-execution hook. If
  it is insufficient, introduce only a narrow MCP execution adapter.
- Never give a workspace the master key or provider/MCP credentials.
- Requalify every release/digest or relevant route/permission/logging change.

## Pin

- Release: `v1.93.0`
- OCI index digest:
  `sha256:a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e`
- Release source: <https://github.com/BerriAI/litellm/releases/tag/v1.93.0>
