# 02 — System Architecture

## Local service map

```text
Browser
  │
  ▼
Next.js web :10254
  │ /v1/*
  ▼
Hono API (same app/runtime)
  │
  ├── Postgres :5433
  │     ├── organizations, members, agents, policy_rules
  │     ├── approval_requests
  │     ├── request_logs / audit_logs
  │     └── app_connections / secrets
  │
  ├── Daytona API :3000
  │     └── Runner / toolbox :4000
  │          └── Sandbox container
  │               └── Claude Code 2.1.195
  │
  ├── JFrog OSS :8082
  │     └── generic artifacts only
  │
  ├── Verdaccio :4873
  │     └── npm package proxy/gate
  │
  └── VTI/TDK mediator :7037
        └── DIDComm / Trust Task transport experiments
```

## Gateway trust path

```text
Sandbox / Claude Code
  │ HTTPS_PROXY (planned default)
  ▼
Rust Gateway :10255
  │
  ├── policy::evaluate()
  │     ├── Block
  │     ├── ManualApproval
  │     ├── RateLimit
  │     └── Allow
  │
  ├── condition_match.rs
  │     ├── body_json:$.field
  │     └── mcp_tool:<name>
  │
  ├── mcp.rs
  │     └── JSON-RPC tools/call parser
  │
  ├── channel.rs
  │     └── route prefix -> channel/protocol
  │
  ├── metrics.rs
  │     └── agent_trust_gateway_* Prometheus metrics
  │
  ├── secret_inject.rs
  │     └── Bearer / x-api-key / generic header injection
  │
  └── identity_injection.rs
        └── signed VP in MCP response (env gated)
```

## Approval + VTI flow

```text
Risky action requested
  │
  ▼
PolicyRule(action=manual_approval)
  │
  ▼
ApprovalRequest
  │
  ├── status = pending
  ├── context = human-readable action payload
  └── context._vti.stepUpRequest
        ├── taskType = auth/step-up/approve-request
        ├── requesterDid
        ├── subjectDid
        ├── agentDid
        ├── requestedActionDigest
        └── proofMode = external_vti_required
  │
  ▼
POST /v1/approvals/:id/vti-notification/trigger
  │
  ▼
delivery.status = sent_to_vti_adapter
  │
  ▼
Future: real VTA/mobile DIDComm delivery + signed response verification
```

## Package gate architecture

```text
Sandbox npm
  │ registry=http://host.docker.internal:4873
  ▼
Verdaccio :4873
  │ proxy/cache
  ▼
npmjs.org

Direct public registry access
  │
  ▼
Rust Gateway blocklist
  ├── registry.npmjs.org
  ├── pypi.org
  ├── files.pythonhosted.org
  ├── crates.io
  └── cdn.jsdelivr.net
```

## Key architectural caveats

1. VTI mobile delivery is not wired yet.
2. Gateway live proxy manual_approval callback still needs full Rust->API bridge.
3. Daytona local works, but production runner should be Linux-hosted, not Docker Desktop.
4. JFrog OSS cannot do npm/PyPI proxy; Verdaccio handles npm.
5. SharePoint/Outlook connectors are not yet live.
