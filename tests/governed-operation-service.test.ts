import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { IdentityContext } from "@onecomputer/contracts";
import type { GovernedToolExecutionInput, GovernedToolExecutionResult, GovernedToolExecutor } from "@onecomputer/litellm-adapter";
import { MemoryWorkspaceStore } from "@onecomputer/workspace-store";
import { FixtureApprovalAuthority, GovernedOperationService, type FixtureApprovalEnvelope } from "../apps/control-api/src/operations.js";

const identity: IdentityContext = { tenantId: "acme", subjectId: "alex-morgan", audience: "onecomputer-control" };
const approvalSecret = "fixture-approval-test-secret-at-least-32-characters";

class FakeExecutor implements GovernedToolExecutor {
  calls: GovernedToolExecutionInput[] = [];
  async executeGovernedTool(input: GovernedToolExecutionInput): Promise<GovernedToolExecutionResult> {
    this.calls.push(input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { upstreamReference: `fixture:${input.operationId}`, resultSummary: "Deleted fixture Q3-draft.docx", result: { deleted: true } };
  }
}

const setup = async () => {
  const store = new MemoryWorkspaceStore();
  const workspace = await store.createOrGet(identity, "personal", randomUUID());
  await store.update(workspace.id, { state: "ready" });
  const executor = new FakeExecutor();
  const authority = new FixtureApprovalAuthority(approvalSecret);
  const service = new GovernedOperationService(store, executor, authority, 60_000);
  return { store, workspace, executor, authority, service };
};

test("destructive operation persists before approval and reaches upstream zero times", async () => {
  const { workspace, executor, service } = await setup();
  const operation = await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-001", "request-1");
  assert.equal(operation.state, "approval_required");
  assert.equal(operation.resourceName, "Q3-draft.docx");
  assert.equal(operation.resourceLocation, "OneDrive / Finance / 2026");
  assert.equal(executor.calls.length, 0);
});

test("mutated approval proof is denied before execution", async () => {
  const { store, workspace, executor, authority, service } = await setup();
  const view = await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-002", "request-2");
  const operation = await store.getOwnedOperation(identity, view.id);
  const now = new Date();
  const envelope: FixtureApprovalEnvelope = {
    version: "1",
    issuer: "onecomputer-local-fixture",
    keyId: "fixture-hmac-v1",
    ...identity,
    operationId: view.id,
    operationDigest: operation!.operationDigest,
    nonce: operation!.nonce,
    decision: "approve",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  };
  const signature = authority.sign(envelope);
  await assert.rejects(
    service.applyApproval(identity, { ...envelope, operationDigest: "0".repeat(64) }, signature, "request-2-approve"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "APPROVAL_PROOF_INVALID",
  );
  assert.equal(executor.calls.length, 0);
});

test("approval binding rejects issuer, key, identity, audience, digest, nonce, expiry, and malformed proof", async () => {
  const { store, workspace, executor, authority, service } = await setup();
  const view = await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-binding", "request-binding");
  const operation = await store.getOwnedOperation(identity, view.id);
  const now = new Date();
  const valid: FixtureApprovalEnvelope = {
    version: "1",
    issuer: "onecomputer-local-fixture",
    keyId: "fixture-hmac-v1",
    ...identity,
    operationId: view.id,
    operationDigest: operation!.operationDigest,
    nonce: operation!.nonce,
    decision: "approve",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  };
  const mutations = [
    { issuer: "wrong-issuer" },
    { keyId: "wrong-key" },
    { tenantId: "wrong-tenant" },
    { subjectId: "wrong-subject" },
    { audience: "wrong-audience" },
    { operationDigest: "0".repeat(64) },
    { nonce: randomUUID() },
  ];
  for (const mutation of mutations) {
    const changed = { ...valid, ...mutation } as FixtureApprovalEnvelope;
    await assert.rejects(
      service.applyApproval(identity, changed, authority.sign(changed), "binding-check"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "APPROVAL_PROOF_INVALID",
    );
  }
  await assert.rejects(
    service.applyApproval(identity, { ...valid, decision: "deny" }, authority.sign(valid), "decision-binding"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "APPROVAL_PROOF_INVALID",
  );
  await assert.rejects(
    service.applyApproval(identity, valid, "malformed", "malformed-proof"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "APPROVAL_PROOF_INVALID",
  );
  const expired = { ...valid, issuedAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() - 1).toISOString() };
  await assert.rejects(
    service.applyApproval(identity, expired, authority.sign(expired), "expired-proof"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "APPROVAL_EXPIRED",
  );
  assert.equal(executor.calls.length, 0);
});

test("concurrent approvals execute one exact operation once", async () => {
  const { workspace, executor, service } = await setup();
  const operation = await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-003", "request-3");
  const [first, second] = await Promise.all([
    service.decideWithFixture(identity, operation.id, "approve", "approval-1"),
    service.decideWithFixture(identity, operation.id, "approve", "approval-2"),
  ]);
  assert.equal(first.state, "succeeded");
  assert.equal(second.state, "succeeded");
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(executor.calls[0].arguments, { path: "/Finance/2026/Q3-draft.docx" });
  assert.equal(first.receipt?.resultSummary, "Deleted fixture Q3-draft.docx");
});

test("fixture denial is terminal and executes zero times", async () => {
  const { workspace, executor, service } = await setup();
  const operation = await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-004", "request-4");
  const denied = await service.decideWithFixture(identity, operation.id, "deny", "denial-1");
  assert.equal(denied.state, "denied");
  assert.equal(executor.calls.length, 0);
});

test("idempotency key cannot be reused with mutated arguments", async () => {
  const { workspace, service } = await setup();
  await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-005", "request-5");
  await assert.rejects(
    service.createDeleteFile(identity, workspace.id, "/Finance/2026/other.docx", "delete-request-005", "request-6"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_MISMATCH",
  );
});

test("direct status mutation without a verified approval record cannot issue a lease", async () => {
  const { store, workspace, executor, service } = await setup();
  const operation = await service.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-006", "request-7");
  const internal = store as unknown as { operations: Map<string, Record<string, unknown>> };
  internal.operations.set(operation.id, { ...internal.operations.get(operation.id)!, state: "approved", approval: null });
  await assert.rejects(
    service.decideWithFixture(identity, operation.id, "approve", "approval-after-tamper"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "APPROVAL_STATE_INVALID",
  );
  assert.equal(executor.calls.length, 0);
});

test("expired operations and abandoned leases recover fail closed", async () => {
  const { store, workspace, executor, authority } = await setup();
  const shortLived = new GovernedOperationService(store, executor, authority, 1);
  const expired = await shortLived.createDeleteFile(identity, workspace.id, "/Finance/2026/Q3-draft.docx", "delete-request-expired", "request-expired");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await shortLived.get(identity, expired.id)).state, "expired");
  assert.equal(executor.calls.length, 0);

  const active = await new GovernedOperationService(store, executor, authority, 60_000)
    .createDeleteFile(identity, workspace.id, "/Finance/2026/other.docx", "delete-request-abandoned", "request-abandoned");
  const internal = store as unknown as { operations: Map<string, Record<string, unknown>> };
  internal.operations.set(active.id, {
    ...internal.operations.get(active.id)!,
    state: "executing",
    leaseId: randomUUID(),
    leaseExpiresAt: new Date(Date.now() - 1),
  });
  const recovered = await shortLived.get(identity, active.id);
  assert.equal(recovered.state, "failed");
  assert.equal(recovered.failureCode, "EXECUTION_LEASE_EXPIRED");
  assert.equal(executor.calls.length, 0);
});
