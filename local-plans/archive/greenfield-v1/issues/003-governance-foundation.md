# 003: build governance contracts and owned PostgreSQL

Status: `complete`

Gate: C
Depends on: 002
Unblocks: 004

## Outcome

The workspace-only contracts and owned PostgreSQL foundation from Issue 001 are
extended into the only authoritative state for identities, workspaces,
capabilities, policy, operations, approvals, leases, receipts, outbox delivery,
and evidence.

## In scope

- Extend the pinned TypeScript monorepo and workspace contracts established by
  Issue 001.
- Add the governance portions of `packages/contracts`, `packages/control`, and
  `packages/db` with enforced dependency direction.
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

- [x] Canonical fixtures hash identically across all callers and after restart.
- [x] Mutation of tenant, subject, workspace, audience, capability, resource
  version, server, tool, schema, arguments, nonce, or expiry changes the digest.
- [x] Clean database migration and empty-state boot pass twice.
- [x] Repository tenant scoping prevents cross-tenant reads and writes.
- [x] Architecture tests prevent vendor, UI, Docker, and database imports from
  crossing forbidden package boundaries.
- [x] Raw secrets and complete sensitive arguments are excluded from evidence
  records by contract.

## Evidence required

Include schema/ERD, migration hashes, canonical fixture corpus, mutation matrix,
dependency graph, clean-start logs, and data classification.

## Stop conditions

- Canonicalization differs by runtime/caller.
- A vendor schema becomes authoritative product state.
- Tenant scoping depends only on caller-supplied filters.

## Completion record

The governed-operation foundation is implemented and machine-verified on
2026-07-19: versioned canonical JSON and SHA-256 binding, mutation tests,
tenant-scoped PostgreSQL repositories, operations, approvals, leases, receipts,
safe events, two-pass clean migration, and package-boundary tests.

This foundation issue is complete for its accepted governed-operation slice.
The broader product records for identity, agent/workspace ownership, reusable
capability assignments, and versioned policy are deliberately specified in the
replacement Issue 005. Cancellation and physical delivery outbox behavior is
specified in Issues 008–009. Moving those product features does not weaken or
repeat the verified canonicalization, tenant-scoping, migration, and dependency
boundary evidence delivered here.

### Human product acceptance

Accepted by the product owner on 2026-07-20. The user verified the persisted
workspace and completed governed-operation presentation in the running product:
owned action and resource details, operation binding, terminal status, and an
execution receipt were all visible after completion. This sign-off is complete
and does not need to be repeated.
