# 002: enforce a workspace egress firewall

Status: `complete`

Priority: P1
Depends on: 001
Unblocks: 003

## Outcome

An administrator can assign a bounded internet-access profile to a workspace,
and an authenticated proxy/network enforcement layer outside the sandbox
allows only the declared destinations, protocols, and ports. Removing proxy
settings or changing an application base URL inside the sandbox cannot create
a direct route around the policy.

## In scope

- Turn the existing restricted egress baseline into an owned, versioned
  workspace egress-policy contract.
- Express reviewed destination rules by normalized host/domain, protocol, port,
  and purpose, with explicit handling for required agent updates and other
  approved public internet access.
- Compile the effective policy into the proxy and network boundary associated
  with the exact tenant, user, workspace, agent, and grant.
- Deny direct egress at the container/network layer so applications cannot
  bypass the proxy by deleting environment variables or opening their own
  sockets.
- Validate DNS resolution, connection targets, HTTP CONNECT, TLS destination
  metadata where available without decryption, redirects, and every new
  connection against the effective rule.
- Add an administrator preview and a user-visible connectivity reason without
  exposing secrets or unrestricted browsing history.
- Preserve the V1 governed LiteLLM, MCP, Control status, Kasm streaming, and
  OpenVTC paths as narrowly declared internal routes.

## Out of scope

- General inbound firewall management, arbitrary user-defined tunnels, VPNs,
  transparent TLS interception, payload inspection, malware classification,
  production claims beyond the inspected Kasm/container topology, or a promise
  to support every internet protocol.

## Required implementation

- Versioned egress policy, assignment, normalization, compilation, and decision
  contracts with deterministic deny-by-default precedence and reason codes.
- Workspace-bound proxy authentication that rejects missing, malformed,
  expired, revoked, cross-tenant, cross-workspace, and wrong-audience grants.
- Network rules that prevent raw TCP/UDP, direct DNS, DNS-over-HTTPS,
  DNS-over-TLS, QUIC, alternate proxies, host-gateway, link-local/metadata,
  private/control-plane, and cross-workspace bypass except for exact owned
  dependencies.
- Safe host handling covering case, trailing dots, IDNA, IPv4/IPv6 literals,
  alternate IP forms, hostile suffixes, resolution changes, redirect chains,
  and DNS rebinding.
- Atomic policy refresh or a documented fail-closed transition for active
  workspaces, plus restart-safe reconciliation and cleanup.
- Metadata-minimized audit events for allow/deny decisions; credentials, query
  strings, payloads, and response bodies are never logged.

## Required verification

- [x] Exact allowlisted web destinations work through the authenticated proxy,
      while an unlisted destination is denied with a stable reason.
- [x] Direct Anthropic/OpenAI/GLM provider, Microsoft Graph, upstream MCP,
      PostgreSQL, Docker, host gateway, metadata/link-local, private network,
      another workspace, and undeclared public destinations fail.
- [x] Removing proxy variables, changing Claude Desktop's base URL, using a raw
      IP, alternate DNS/DoH/DoT, QUIC, CONNECT, an alternate port, a redirect,
      a hostile suffix, or DNS rebinding cannot bypass enforcement.
- [x] Missing, malformed, expired, revoked, cross-boundary replayed, wrong-tenant,
      wrong-workspace, wrong-agent, and wrong-audience proxy grants issue no
      upstream connection.
- [x] Policy update, proxy restart, Control restart, DNS failure, policy-store
      outage, partial reconciliation, and concurrent workspace lifecycle
      actions fail closed and recover without stale rules.
- [x] The declared LiteLLM/MCP/Control/Kasm/OpenVTC internal paths and approved
      update path still work, and no secret or prohibited request data appears
      in logs or evidence.

## Evidence required

Include the threat model and supported-protocol boundary, policy schema and
effective-policy samples, proxy/network pins, rule and route inspection, full
destination/bypass matrix, identity and refresh tests, restart/reconciliation
results, metadata-redaction inspection, and cleanup proof.

## Stop conditions

- Enforcement relies on proxy environment variables, application cooperation,
  sandbox-readable credentials, DNS alone, or a mutable file inside the
  workspace.
- A required dependency can reach arbitrary internet destinations or reuse a
  grant across workspace identities.
- Passing requires an allow-by-default transition, substring host matching,
  mutable image tags, broad private-network access, or logging sensitive
  request content.
- Product requirements demand TLS payload inspection or unsupported protocols
  without an explicit architecture and privacy decision.

## Completion record

Completed on 2026-07-23.

Architecture decision: the product capability is named **Egress firewall**.
Administrators manage reusable, tenant-scoped **network security groups** whose
versions contain deny-by-default outbound rules. Each sandbox policy assignment
pins exactly one security-group version; V2 does not merge multiple groups.
The effective assignment is enforced by a per-workspace proxy sidecar outside
the sandbox, while the sandbox remains on an internal-only network. The Admin
control plane owns group versions and attachments; the Sandbox screen shows a
read-only assigned-firewall summary and connectivity reasons.

The supported public-internet boundary is deliberately small: HTTP and HTTPS
domain rules with exact ports. HTTPS is checked with CONNECT and TLS SNI
metadata without decryption, so URL paths are not filterable and SSL scanning,
IPS, content classification, and deep packet inspection remain out of scope.
Raw IPs, unlisted domains, private/reserved resolution answers, alternate
ports, and direct non-proxy egress fail closed.

Verification: 116 repository tests passed; every workspace build passed; and an
isolated real-container qualification proved the sandbox had only an internal
network, the sidecar alone held the external route, an exact allowed HTTPS
destination connected, and unlisted-provider, raw-IP, alternate-port, and
proxy-removal attempts failed. The sidecar audit contained decision metadata
without grants, verification secrets, query strings, payloads, or bodies.

Evidence:
`.artifacts/v2/issues/002/20260723T050331Z/`
