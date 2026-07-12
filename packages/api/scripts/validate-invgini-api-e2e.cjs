#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../../..");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for the InvGini API E2E validation");
  process.exit(1);
}

require.extensions[".ts"] = (mod, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      skipLibCheck: true,
    },
    fileName: filename,
  }).outputText;
  mod._compile(transpiled, filename);
};

const { Hono } = require("hono");
const { db } = require("@onecli/db");
const { agentRoutes } = require(
  path.join(repoRoot, "packages/api/src/routes/agents.ts"),
);

const PROJECT_ID = "00000000-0000-4000-8000-900000000001";
const PROJECT_ID_2 = "00000000-0000-4000-8000-900000000011";
const ORG_ID = "00000000-0000-4000-8000-900000000002";
const USER_ID = "00000000-0000-4000-8000-900000000003";
const API_KEY = "oc_invgini_api_e2e_000000000000000000000000000001";
const API_KEY_2 = "oc_invgini_api_e2e_000000000000000000000000000011";

const app = new Hono().basePath("/v1");
app.route("/agents", agentRoutes());

const loadFixture = () =>
  JSON.parse(
    fs.readFileSync(
      process.env.INVGINI_EVENTS_FIXTURE ||
        path.join(repoRoot, "docs/invgini-agent-events.example.json"),
      "utf8",
    ),
  );

const seedAuth = async () => {
  await db.organization.upsert({
    where: { id: ORG_ID },
    create: {
      id: ORG_ID,
      name: "InvGini API E2E Org",
      slug: "invgini-api-e2e-org",
    },
    update: {},
  });
  await db.user.upsert({
    where: { id: USER_ID },
    create: {
      id: USER_ID,
      email: "owner@example.com",
      name: "InvGini API E2E Owner",
      externalAuthId: "invgini-api-e2e-owner",
    },
    update: { email: "owner@example.com" },
  });
  await db.project.upsert({
    where: { id: PROJECT_ID },
    create: {
      id: PROJECT_ID,
      name: "InvGini API E2E Project",
      slug: "invgini-api-e2e-project",
      organizationId: ORG_ID,
      createdByUserId: USER_ID,
      createdByUserEmail: "owner@example.com",
    },
    update: { organizationId: ORG_ID },
  });
  await db.project.upsert({
    where: { id: PROJECT_ID_2 },
    create: {
      id: PROJECT_ID_2,
      name: "InvGini API E2E Project Two",
      slug: "invgini-api-e2e-project-two",
      organizationId: ORG_ID,
      createdByUserId: USER_ID,
      createdByUserEmail: "owner@example.com",
    },
    update: { organizationId: ORG_ID },
  });
  await db.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: ORG_ID, userId: USER_ID },
    },
    create: {
      organizationId: ORG_ID,
      userId: USER_ID,
      userEmail: "owner@example.com",
      role: "owner",
    },
    update: { userEmail: "owner@example.com", role: "owner" },
  });
  await db.invginiAgentEventLog.deleteMany({
    where: { projectId: { in: [PROJECT_ID, PROJECT_ID_2] } },
  });
  await db.invginiAgentPrincipal.deleteMany({
    where: { projectId: { in: [PROJECT_ID, PROJECT_ID_2] } },
  });
  await db.apiKey.upsert({
    where: { key: API_KEY },
    create: {
      key: API_KEY,
      name: "InvGini API E2E key",
      userId: USER_ID,
      userEmail: "owner@example.com",
      projectId: PROJECT_ID,
      scope: "project",
    },
    update: {
      userId: USER_ID,
      userEmail: "owner@example.com",
      projectId: PROJECT_ID,
      scope: "project",
    },
  });
  await db.apiKey.upsert({
    where: { key: API_KEY_2 },
    create: {
      key: API_KEY_2,
      name: "InvGini API E2E key two",
      userId: USER_ID,
      userEmail: "owner@example.com",
      projectId: PROJECT_ID_2,
      scope: "project",
    },
    update: {
      userId: USER_ID,
      userEmail: "owner@example.com",
      projectId: PROJECT_ID_2,
      scope: "project",
    },
  });
};

const request = async (path, init = {}, apiKey = API_KEY) =>
  app.request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });

const buildSecondProjectRegisteredFixture = (fixture) => {
  const cloned = structuredClone(fixture.events[0]);
  cloned.principal = {
    ...cloned.principal,
    id: "00000000-0000-4000-8000-900000000101",
    did: "did:invgini:agent:00000000000040008000000000000011",
    displayName: "Second project diligence coworker",
    sourceRefId: "00000000-0000-4000-8000-900000000111",
  };
  cloned.mandates = cloned.mandates.map((mandate, index) => ({
    ...mandate,
    id: `00000000-0000-4000-8000-90000000020${index + 1}`,
    title: "Second project coworker mandate",
  }));
  cloned.resourceGrants = cloned.resourceGrants.map((grant, index) => ({
    ...grant,
    id: `00000000-0000-4000-8000-90000000030${index + 1}`,
    resourceId: "00000000-0000-4000-8000-900000000111",
  }));
  return { events: [cloned] };
};

const expectOk = async (response, label) => {
  if (!response.ok) {
    throw new Error(
      `${label} failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
};

const expectRejected = async (response, label) => {
  if (response.ok) {
    throw new Error(
      `${label} unexpectedly succeeded: ${await response.text()}`,
    );
  }
  return response.text();
};

const findRegistryEntry = (entries, principalId) => {
  const entry = entries.find((item) => item.principal.id === principalId);
  if (!entry) {
    throw new Error(`Registry did not include principal ${principalId}`);
  }
  return entry;
};

const main = async () => {
  await seedAuth();

  const fixture = loadFixture();
  const primaryPrincipalId = fixture.events[0].principal.id;
  const registered = { events: [fixture.events[0]] };
  const pendingEvent = structuredClone(fixture.events[1]);
  pendingEvent.eventType = "ActionRequested";
  pendingEvent.actionRequest.status = "PENDING";
  pendingEvent.actionRequest.decidedByUserId = null;
  pendingEvent.actionRequest.decidedAt = null;
  const pending = { events: [pendingEvent] };
  const decided = { events: [fixture.events[1]] };
  const receipt = { events: [fixture.events[2]] };

  const registeredResponse = await expectOk(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registered),
    }),
    "AgentRegistered ingest",
  );
  if (
    registeredResponse.accepted !== true ||
    registeredResponse.eventCount !== 1
  ) {
    throw new Error("AgentRegistered response did not acknowledge one event");
  }

  let registry = await expectOk(
    await request("/v1/agents/invgini-governance"),
    "Registry list after registration",
  );
  if (registry.length < 1)
    throw new Error("Expected at least one registry entry");
  let primaryEntry = findRegistryEntry(registry, primaryPrincipalId);
  if (primaryEntry.principal.did !== fixture.events[0].principal.did) {
    throw new Error("Registry principal DID mismatch after registration");
  }
  if (primaryEntry.project.name !== "InvGini API E2E Project") {
    throw new Error("Registry did not include project metadata");
  }
  if (
    primaryEntry.principal.metadata?.affinidi_status !== "not_issued" ||
    primaryEntry.principal.metadata?.affinidi_credential_type !==
      "InvGiniAgentAuthorityCredential"
  ) {
    throw new Error("Registry did not persist principal identity metadata");
  }
  if (
    primaryEntry.mandates.length < 1 ||
    primaryEntry.resourceGrants.length < 1
  ) {
    throw new Error("Registry did not persist mandate/resource grant snapshot");
  }

  await expectOk(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pending),
    }),
    "ActionRequested ingest",
  );
  registry = await expectOk(
    await request("/v1/agents/invgini-governance"),
    "Registry list after pending request",
  );
  primaryEntry = findRegistryEntry(registry, primaryPrincipalId);
  if (primaryEntry.pendingActionRequests.length !== 1) {
    throw new Error(
      "Expected one pending action request after ActionRequested",
    );
  }
  if (primaryEntry.pendingActionRequests[0].status !== "PENDING") {
    throw new Error("Pending action request status mismatch");
  }
  if (primaryEntry.pendingActionRequests[0].riskScore < 55) {
    throw new Error("Pending action request risk score mismatch");
  }
  if (!primaryEntry.eventLogCount || !primaryEntry.lastEventHash) {
    throw new Error("Registry did not expose event-log truth metadata");
  }
  if (!primaryEntry.pendingActionRequests[0].policySignals) {
    throw new Error("Pending action request policy telemetry missing");
  }
  if ("chatId" in primaryEntry.pendingActionRequests[0].resource) {
    throw new Error("VTI bridge event leaked raw chatId into resource");
  }
  if (
    primaryEntry.pendingActionRequests[0].vtiBridge?.opaqueHandle?.id !==
      "oph:telegram:legal-mfa-review" ||
    primaryEntry.pendingActionRequests[0].vtiBridge?.rawConnectorIdPresent !==
      false
  ) {
    throw new Error(
      "Pending request did not persist VTI opaque-handle metadata",
    );
  }

  const invalidRawVtiEvent = structuredClone(pendingEvent);
  invalidRawVtiEvent.id = "00000000-0000-4000-8000-900000000909";
  invalidRawVtiEvent.actionRequest = {
    ...invalidRawVtiEvent.actionRequest,
    id: "00000000-0000-4000-8000-900000000910",
    vtiBridge: {
      trustTaskId: "tt-invalid-raw-connector",
      connectorCustodyMode: "opaque_handle",
      rawConnectorIdPresent: false,
      opaqueHandle: { id: "oph:telegram:legal-mfa-review" },
      messageId: "raw-platform-message-id",
    },
  };
  await expectRejected(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [invalidRawVtiEvent] }),
    }),
    "Raw connector VTI bridge ingest",
  );

  const invalidRawResourceEvent = structuredClone(pendingEvent);
  invalidRawResourceEvent.actionRequest = {
    ...invalidRawResourceEvent.actionRequest,
    id: "00000000-0000-4000-8000-900000000911",
    resource: { chatId: "raw-platform-chat-id" },
  };
  await expectRejected(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [invalidRawResourceEvent] }),
    }),
    "Raw connector resource ingest",
  );

  await expectOk(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decided),
    }),
    "ActionDecided ingest",
  );
  registry = await expectOk(
    await request("/v1/agents/invgini-governance"),
    "Registry list after decision",
  );
  primaryEntry = findRegistryEntry(registry, primaryPrincipalId);
  if (primaryEntry.pendingActionRequests.length !== 0) {
    throw new Error(
      "Approved/rejected action request should not remain pending",
    );
  }
  if (
    !primaryEntry.actionRequests.some(
      (request) => request.id === decided.events[0].actionRequest.id,
    )
  ) {
    throw new Error("Expected decided action request in history");
  }

  await expectOk(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    }),
    "ReceiptCreated ingest",
  );
  registry = await expectOk(
    await request("/v1/agents/invgini-governance"),
    "Registry list after receipt",
  );
  primaryEntry = findRegistryEntry(registry, primaryPrincipalId);
  const currentReceipt = primaryEntry.actionReceipts.find(
    (item) => item.id === receipt.events[0].receipt.id,
  );
  if (!currentReceipt) {
    throw new Error("Expected one action receipt after ReceiptCreated");
  }
  if (currentReceipt.outcome !== "SUCCESS") {
    throw new Error("Action receipt outcome mismatch");
  }
  if ("chatId" in currentReceipt.resource) {
    throw new Error("VTI bridge receipt leaked raw chatId into resource");
  }
  if (
    currentReceipt.vtiBridge?.trustTaskType !==
      "https://trusttasks.org/spec/invgini/agent/action-receipt/0.1" ||
    !currentReceipt.vtiBridge?.bridgeReceiptHash
  ) {
    throw new Error("Action receipt did not persist VTI Trust Task metadata");
  }

  const evidencePack = await expectOk(
    await request(
      `/v1/agents/invgini-governance/${primaryEntry.principal.id}/evidence-pack`,
    ),
    "Evidence pack export",
  );
  if (
    evidencePack.principal.did !== primaryEntry.principal.did ||
    evidencePack.vtiBridgeArtifacts.length < 2
  ) {
    throw new Error("Evidence pack did not include VTI bridge artifacts");
  }
  if (evidencePack.eventLogs.length < 4) {
    throw new Error("Evidence pack did not include event-log flight recorder");
  }
  const eventLogs = await expectOk(
    await request(
      `/v1/agents/invgini-governance/${primaryEntry.principal.id}/events`,
    ),
    "Event-log flight recorder export",
  );
  if (eventLogs.length !== evidencePack.eventLogs.length) {
    throw new Error("Event-log endpoint/evidence-pack count mismatch");
  }

  const duplicateEventLogCount = eventLogs.length;
  await expectOk(
    await request("/v1/agents/invgini-governance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    }),
    "Duplicate ReceiptCreated ingest",
  );
  const afterDuplicateLogs = await expectOk(
    await request(
      `/v1/agents/invgini-governance/${primaryEntry.principal.id}/events`,
    ),
    "Event-log flight recorder after duplicate",
  );
  if (afterDuplicateLogs.length !== duplicateEventLogCount) {
    throw new Error("Duplicate event ingest was not idempotent by event hash");
  }

  const control = await expectOk(
    await request(
      `/v1/agents/invgini-governance/${primaryEntry.principal.id}/controls`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "FREEZE_AGENT",
          reason:
            "E2E SecOps freeze intent before composed enforcement bridge.",
          resource: { source: "validate-invgini-api-e2e" },
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
      },
    ),
    "SecOps control action create",
  );
  if (
    control.action !== "FREEZE_AGENT" ||
    control.status !== "OPEN" ||
    control.expiresAt !== "2030-01-01T00:00:00.000Z"
  ) {
    throw new Error("Control action response mismatch");
  }
  registry = await expectOk(
    await request("/v1/agents/invgini-governance"),
    "Registry list after control action",
  );
  primaryEntry = findRegistryEntry(registry, primaryPrincipalId);
  if (primaryEntry.controlActions.length < 1) {
    throw new Error("Expected at least one SecOps control action in registry");
  }
  if (
    !primaryEntry.controlActions.some(
      (controlAction) => controlAction.action === "FREEZE_AGENT",
    )
  ) {
    throw new Error("SecOps control action mismatch in registry");
  }

  const resolvedControl = await expectOk(
    await request(
      `/v1/agents/invgini-governance/${primaryEntry.principal.id}/controls/${control.id}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "RESOLVED",
          reason: "E2E SecOps resolved the freeze intent after review.",
        }),
      },
    ),
    "SecOps control action resolve",
  );
  if (
    resolvedControl.status !== "RESOLVED" ||
    !resolvedControl.resolvedAt ||
    resolvedControl.resolutionReason !==
      "E2E SecOps resolved the freeze intent after review."
  ) {
    throw new Error("Control action resolution response mismatch");
  }

  await expectOk(
    await request(
      "/v1/agents/invgini-governance/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSecondProjectRegisteredFixture(fixture)),
      },
      API_KEY_2,
    ),
    "Second project AgentRegistered ingest",
  );

  const fleetRegistry = await expectOk(
    await request("/v1/agents/invgini-governance/fleet"),
    "Organization fleet registry list",
  );
  const fleetProjectIds = new Set(
    fleetRegistry.map((entry) => entry.project.id),
  );
  if (!fleetProjectIds.has(PROJECT_ID) || !fleetProjectIds.has(PROJECT_ID_2)) {
    throw new Error("Organization fleet endpoint did not span both projects");
  }
  if (fleetRegistry.length < 2) {
    throw new Error("Expected at least two fleet registry entries");
  }

  console.log(
    JSON.stringify({
      ok: true,
      projectId: PROJECT_ID,
      principalDid: primaryEntry.principal.did,
      mandates: primaryEntry.mandates.length,
      resourceGrants: primaryEntry.resourceGrants.length,
      pendingActionRequests: primaryEntry.pendingActionRequests.length,
      actionReceipts: primaryEntry.actionReceipts.length,
      controlActions: primaryEntry.controlActions.length,
      resolvedControlStatus: resolvedControl.status,
      fleetProjects: fleetProjectIds.size,
      identityMetadata: primaryEntry.principal.metadata?.affinidi_status,
      eventLogs: evidencePack.eventLogs.length,
      vtiBridgeArtifacts: evidencePack.vtiBridgeArtifacts.length,
      fleetAgents: fleetRegistry.length,
    }),
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
