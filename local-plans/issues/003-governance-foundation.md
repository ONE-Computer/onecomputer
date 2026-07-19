# 003: build governance contracts and owned PostgreSQL

Status: `blocked`

Gate: C
Depends on: 002
Unblocks: 004

## Outcome

Versioned governance contracts and a new ONEComputer PostgreSQL schema provide
the only authoritative state for identities, workspaces, capabilities, policy,
operations, approvals, leases, receipts, outbox delivery, and evidence.

## In scope

- Scaffold the minimal TypeScript monorepo and pinned toolchain.
- Create `packages/contracts`, `packages/control`, and `packages/db` with
  enforced dependency direction.
- Define strict versioned schemas, canonical JSON rules, operation hashing,
  bounded errors, and correlation identifiers.
- Create the minimum owned schema and transactional repository interfaces.
- Add migrations, clean-start deployment, forward-compatibility rules, and
  deterministic test factories.
- Reject unknown required fields and prevent vendor types/databases from
  entering owned contracts.

## Out of scope

- Public API, LiteLLM calls, Docker/Kasm, UI, physical OpenVTC, OneDrive, data
  imports, or legacy schema compatibility.

## Required verification

- [ ] Canonical fixtures hash identically across all callers and after restart.
- [ ] Mutation of tenant, subject, workspace, audience, capability, resource
  version, server, tool, schema, arguments, nonce, or expiry changes the digest.
- [ ] Clean database migration and empty-state boot pass twice.
- [ ] Repository tenant scoping prevents cross-tenant reads and writes.
- [ ] Architecture tests prevent vendor, UI, Docker, and database imports from
  crossing forbidden package boundaries.
- [ ] Raw secrets and complete sensitive arguments are excluded from evidence
  records by contract.

## Evidence required

Include schema/ERD, migration hashes, canonical fixture corpus, mutation matrix,
dependency graph, clean-start logs, and data classification.

## Stop conditions

- Canonicalization differs by runtime/caller.
- A vendor schema becomes authoritative product state.
- Tenant scoping depends only on caller-supplied filters.

## Completion record

Not complete.
