# Issue 005 identity and policy qualification

Date: 2026-07-20

Branch: `mike/greenfield-v1`

Base revision before Issue 005: `aa4e97b`

Status: automated qualification passed; one real Entra sign-in remains for
human review.

## Implemented boundary

- ONEComputer Web now begins a single-tenant Entra authorization-code flow
  with PKCE, state, and nonce at `/api/v1/auth/login`.
- Control validates the signed ID token against Microsoft JWKS and creates an
  opaque, hashed, revocable PostgreSQL-backed `HttpOnly` server session.
- Normal runtime identity comes only from that session. Vite no longer sends
  tenant, subject, audience, or role headers. Header identity exists only
  behind the explicit `testIdentityMode` factory option used by automated
  tests.
- The owned PostgreSQL schema now persists tenants, users, external identities,
  roles, sessions, agent identities, workspace identities, LiteLLM vendor-user
  mappings, capabilities, immutable policy versions, policy assignments, and
  capability assignments.
- The first configured ME TECH administrator is bootstrapped once and that
  completion is persisted on the tenant. Later authorization reads roles only
  from PostgreSQL; removing the role is not undone on the next login.
- The existing owned identity remains `acme / alex-morgan`, so its deterministic
  LiteLLM user mapping is unchanged and the existing `mike@metech.dev`
  Microsoft credential can be reused without token export or relocation.
- The owned Admin page can inspect users and their effective version, assign or
  revoke the one MVP bundle, and create a new immutable version. Existing
  assignments stay pinned until explicitly revoked and reassigned.

## Policy projection

The tenant-scoped `mvp-standard:<tenant>` bundle contains one explicit
projection:

- workspace profile: `kasm-persistent-standard`;
- agent profile: `onecomputer-default-agent`;
- model alias: `onecomputer-assistant`;
- network profile: `controlled-egress-v1`;
- Microsoft MCP server with bounded Mail, Calendar, and OneDrive read tools;
- standard AI/coding/Microsoft-read capabilities;
- protected OneDrive delete set to `approval_required`, with other writes
  denied.

This is an owned versioned document, not a general policy language. Issue 006
will materialize it into the actual Kasm workspace and agent grant.

## Role and API matrix

| Surface | Unauthenticated | Employee | Administrator |
| --- | --- | --- | --- |
| Session/profile | Deny | Own identity | Own identity |
| Own workspace and connection | Deny | Allow with active policy | Allow with active policy |
| Inspect tenant users/policy | Deny | Deny | Allow, same tenant only |
| Assign/revoke/version policy | Deny | Deny | Allow, same tenant only |
| Caller identity/role headers | Ignored | Ignored | Ignored |

## Automated evidence

- `npm run build`: passed for every workspace.
- `npm test`: 46/46 passed.
- Entra unit qualification covers state-cookie binding, one-time state, PKCE,
  signed-token verification boundary, nonce, tenant, durable owned identity,
  deterministic LiteLLM user mapping, opaque session, and replay denial.
- Control boundary tests prove identity/role headers cannot authenticate or
  override a session, employee admin access denies, cross-tenant target IDs
  return not found, and revocation removes both legacy-default and agent keys.
- PostgreSQL qualification ran in a disposable database using
  `infra/issue-005/qualify-identity-policy.mjs`. It passed identity mapping,
  agent/workspace/vendor/capability persistence, session and policy survival
  across store restart, immutable version pinning, revoke/reassign to version
  2, and cross-tenant denial. The database was removed afterward.
- Direct mutation of `policy_versions` failed with `policy versions are
  immutable`.
- Live unauthenticated session and spoofed-admin requests returned `401`.
- The live OAuth callback sentinel did not occur in Control logs.
- Browser source/bundle, Control logs, owned identity/policy evidence rows, and
  safe API responses contained none of the configured Entra client secret,
  LiteLLM master key, LiteLLM credential secret, proxy token, or controller
  token.

Migration SHA-256 after qualification:

```text
a8cb4ca2148c08db95c7dcbd47c839c9b01aa251802ba8014d071540977fa4f2
```

## Human review required

In the Entra app registration, add this additional **Web** redirect URI:

```text
http://localhost:4174/api/v1/auth/callback
```

Then open `http://localhost:4174`, choose **Sign in with Microsoft**, select
`mike@metech.dev`, and verify:

1. the home page shows Mike/ME TECH rather than the prototype Alex identity;
2. the existing persistent workspace is still present;
3. Connections shows the existing Microsoft 365 connection;
4. Admin shows Mike as administrator with policy version 1 assigned;
5. after a Control restart, refreshing the browser keeps the same session,
   workspace, mapping, and policy projection.

Do not disconnect Microsoft 365 or delete the workspace during this review.

## Residual risks

- Local Compose may fall back to the existing credential-encryption secret for
  the session secret to avoid invalidating the current local stack. Production
  must set the separate `ONECOMPUTER_SESSION_SECRET` shown in `.env.example`.
- The real-model route, policy-built Kasm image/agent, actual Microsoft tool
  grants, and OpenVTC delivery remain Issues 006–009; this issue does not claim
  those outcomes.
