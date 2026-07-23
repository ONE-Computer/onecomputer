import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityContext } from "@onecomputer/contracts";
import { MemoryWorkspaceStore } from "@onecomputer/workspace-store";
import { createControlServer } from "../apps/control-api/src/server.js";
import type { ControllerClient } from "../apps/control-api/src/service.js";

const proxyToken = "companion-activity-proxy-token-at-least-24-characters";
const identity: IdentityContext = { tenantId: "activity-tenant", subjectId: "activity-owner", audience: "onecomputer-control" };
const otherIdentity: IdentityContext = { ...identity, subjectId: "other-owner" };
const headersFor = (value: IdentityContext) => ({
  "x-onecomputer-proxy-token": proxyToken,
  "x-onecomputer-test-tenant-id": value.tenantId,
  "x-onecomputer-test-user-id": value.subjectId,
});

test("companion activity is owned, redacted, stable across pages, and read-only", async () => {
  const store = new MemoryWorkspaceStore();
  const workspace = await store.createOrGet(identity, "personal", "activity-workspace");
  const otherWorkspace = await store.createOrGet(otherIdentity, "personal", "other-workspace");
  const base = Date.now() + 60_000;

  const createOperation = async (input: {
    id: string;
    owner: IdentityContext;
    workspaceId: string;
    createdAt: Date;
    secret: string;
  }) => {
    const operation = await store.createGovernedOperation({
      id: input.id,
      identity: input.owner,
      workspaceId: input.workspaceId,
      agentId: "private-agent-identifier",
      capabilityId: "m365-write-protected",
      serverName: "onecomputer_ms365",
      toolName: "send-mail",
      schemaId: "onecomputer.m365.send-mail.v1",
      arguments: { privateBody: input.secret },
      operationDigest: "d".repeat(64),
      nonce: `private-nonce-${input.id}`,
      safeSummary: "Send a prepared email",
      resourceName: "Prepared email",
      resourceLocation: "Outlook Mail",
      correlationId: `private-correlation-${input.id}`,
      idempotencyKey: `activity-${input.id}`,
      createdAt: input.createdAt,
      expiresAt: new Date(input.createdAt.getTime() + 10 * 60_000),
    });
    assert.ok(operation);
  };

  const ownedIds = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  await createOperation({ id: ownedIds[0]!, owner: identity, workspaceId: workspace.id, createdAt: new Date(base), secret: "first-private-body" });
  await createOperation({ id: ownedIds[1]!, owner: identity, workspaceId: workspace.id, createdAt: new Date(base), secret: "second-private-body" });
  await createOperation({ id: ownedIds[2]!, owner: identity, workspaceId: workspace.id, createdAt: new Date(base + 1_000), secret: "third-private-body" });
  await createOperation({
    id: "00000000-0000-4000-8000-000000000004",
    owner: otherIdentity,
    workspaceId: otherWorkspace.id,
    createdAt: new Date(base + 2_000),
    secret: "cross-owner-private-body",
  });

  const app = createControlServer(store, {} as ControllerClient, proxyToken, undefined, undefined, {}, { testIdentityMode: true });
  const first = await app.inject({
    method: "GET",
    url: "/v1/openvtc/companion/activity?limit=2",
    headers: headersFor(identity),
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().activities.map((item: { id: string }) => item.id), [ownedIds[2], ownedIds[1]]);
  assert.equal(typeof first.json().nextCursor, "string");

  const second = await app.inject({
    method: "GET",
    url: `/v1/openvtc/companion/activity?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    headers: headersFor(identity),
  });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().activities.map((item: { id: string }) => item.id), [ownedIds[0]]);
  assert.equal(second.json().nextCursor, null);

  const serialized = JSON.stringify([first.json(), second.json()]);
  for (const prohibited of [
    "first-private-body",
    "second-private-body",
    "third-private-body",
    "cross-owner-private-body",
    "private-agent-identifier",
    "private-correlation",
    "private-nonce",
    "operationDigest",
    "arguments",
    "policyHash",
    workspace.id,
  ]) {
    assert.ok(!serialized.includes(prohibited), `activity projection exposed ${prohibited}`);
  }

  const detail = await app.inject({
    method: "GET",
    url: `/v1/openvtc/companion/activity/${ownedIds[2]}`,
    headers: headersFor(identity),
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().activity.action, "Send a prepared email");
  assert.deepEqual(detail.json().timeline.map((event: { label: string }) => event.label), ["Approval requested"]);
  assert.ok(!JSON.stringify(detail.json()).includes("third-private-body"));

  const crossOwner = await app.inject({
    method: "GET",
    url: `/v1/openvtc/companion/activity/${ownedIds[2]}`,
    headers: headersFor(otherIdentity),
  });
  assert.equal(crossOwner.statusCode, 404);

  const invalidCursor = await app.inject({
    method: "GET",
    url: "/v1/openvtc/companion/activity?cursor=not-a-cursor",
    headers: headersFor(identity),
  });
  assert.equal(invalidCursor.statusCode, 400);
  assert.equal(invalidCursor.json().error.code, "INVALID_ACTIVITY_CURSOR");
  await app.close();
});
