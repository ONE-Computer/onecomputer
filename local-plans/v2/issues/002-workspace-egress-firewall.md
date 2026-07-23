# 002: enforce a workspace egress firewall

Status: `blocked`

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

- [ ] Exact allowlisted web destinations work through the authenticated proxy,
      while an unlisted destination is denied with a stable reason.
- [ ] Direct Anthropic/OpenAI/GLM provider, Microsoft Graph, upstream MCP,
      PostgreSQL, Docker, host gateway, metadata/link-local, private network,
      another workspace, and undeclared public destinations fail.
- [ ] Removing proxy variables, changing Claude Desktop's base URL, using a raw
      IP, alternate DNS/DoH/DoT, QUIC, CONNECT, an alternate port, a redirect,
      a hostile suffix, or DNS rebinding cannot bypass enforcement.
- [ ] Missing, malformed, expired, revoked, replayed, wrong-tenant,
      wrong-workspace, wrong-agent, and wrong-audience proxy grants issue no
      upstream connection.
- [ ] Policy update, proxy restart, Control restart, DNS failure, policy-store
      outage, partial reconciliation, and concurrent workspace lifecycle
      actions fail closed and recover without stale rules.
- [ ] The declared LiteLLM/MCP/Control/Kasm/OpenVTC internal paths and approved
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

Not complete.
