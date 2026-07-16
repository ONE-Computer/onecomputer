import { createHash } from "node:crypto";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const PERSONAL_CONNECTOR_KINDS = [
  "personal_gmail",
  "personal_outlook",
  "personal_calendar",
  "personal_drive",
  "personal_notes",
  "telegram_export",
  "whatsapp_export",
] as const;

export type PersonalConnectorKind = (typeof PERSONAL_CONNECTOR_KINDS)[number];

export type PersonalConnectorAccessMode = "read_only";

export interface PersonalConnectorScope {
  labels?: string[];
  folders?: string[];
  dateFrom?: string;
  dateTo?: string;
  query?: string;
}

export interface PersonalConnectorGrantInput {
  connectorId: string;
  connectorKind: PersonalConnectorKind;
  userId: string;
  agentId: string;
  purpose: string;
  scope: PersonalConnectorScope;
  ttlMinutes: number;
  maxItems: number;
  issuedAt: string;
  accessMode?: PersonalConnectorAccessMode;
}

export interface PersonalConnectorGrant {
  schemaVersion: "onecomputer.personal-connector-grant.v1";
  grantId: string;
  grantHash: string;
  connectorId: string;
  connectorKind: PersonalConnectorKind;
  userId: string;
  agentId: string;
  purpose: string;
  scope: PersonalConnectorScope;
  accessMode: PersonalConnectorAccessMode;
  issuedAt: string;
  expiresAt: string;
  maxItems: number;
  status: "active" | "revoked";
  runtimeCredentialMode: "broker_custodied_never_agent_runtime";
  evidenceRequired: true;
}

export interface PersonalConnectorRuntimeContext {
  grant: PersonalConnectorGrant;
  credentialMaterial?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  password?: unknown;
  apiKey?: unknown;
}

export interface PersonalConnectorSourceItem {
  itemId: string;
  title: string;
  snippet: string;
  sourceUri?: string;
  receivedAt?: string;
  labels?: string[];
}

export interface PersonalConnectorSnippet {
  itemId: string;
  title: string;
  snippet: string;
  sourceUriHash?: string;
  receivedAt?: string;
  labels?: string[];
}

export interface PersonalConnectorRetrieval {
  schemaVersion: "onecomputer.personal-connector-retrieval.v1";
  retrievalId: string;
  retrievalHash: string;
  grantHash: string;
  connectorId: string;
  connectorKind: PersonalConnectorKind;
  agentId: string;
  purpose: string;
  query: string;
  returnedItems: number;
  snippets: PersonalConnectorSnippet[];
  evidence: {
    source: "personal_connector_broker";
    rawCredentialExposedToRuntime: false;
    rawContentStored: false;
    sourceItemHashes: string[];
  };
}

const minuteMs = 60_000;
const maxGrantTtlMinutes = 60;
const maxGrantItems = 50;

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

const addMinutes = (iso: string, minutes: number): string =>
  new Date(new Date(iso).getTime() + minutes * minuteMs).toISOString();

export const createReadOnlyPersonalConnectorGrant = (
  input: PersonalConnectorGrantInput,
): PersonalConnectorGrant => {
  if ((input.accessMode ?? "read_only") !== "read_only") {
    throw new Error("Personal connector grants are read-only in the pilot");
  }
  if (input.ttlMinutes < 1 || input.ttlMinutes > maxGrantTtlMinutes) {
    throw new Error(
      `Personal connector grant TTL must be 1-${maxGrantTtlMinutes} minutes`,
    );
  }
  if (input.maxItems < 1 || input.maxItems > maxGrantItems) {
    throw new Error(`Personal connector maxItems must be 1-${maxGrantItems}`);
  }
  if (input.purpose.trim().length < 8) {
    throw new Error(
      "Personal connector grant purpose is required and must be specific",
    );
  }

  const seed = {
    schemaVersion: "onecomputer.personal-connector-grant.v1" as const,
    connectorId: input.connectorId,
    connectorKind: input.connectorKind,
    userId: input.userId,
    agentId: input.agentId,
    purpose: input.purpose.trim(),
    scope: input.scope,
    accessMode: "read_only" as const,
    issuedAt: input.issuedAt,
    expiresAt: addMinutes(input.issuedAt, input.ttlMinutes),
    maxItems: input.maxItems,
  };
  const grantHash = sha256(canonicalJson(asJson(seed)));

  return {
    ...seed,
    grantId: grantHash.slice("sha256:".length, "sha256:".length + 16),
    grantHash,
    status: "active",
    runtimeCredentialMode: "broker_custodied_never_agent_runtime",
    evidenceRequired: true,
  };
};

export const revokePersonalConnectorGrant = (
  grant: PersonalConnectorGrant,
): PersonalConnectorGrant => ({ ...grant, status: "revoked" });

export const assertNoCredentialMaterialInRuntime = (
  context: PersonalConnectorRuntimeContext,
): void => {
  const leakedKeys = [
    "credentialMaterial",
    "accessToken",
    "refreshToken",
    "password",
    "apiKey",
  ].filter(
    (key) =>
      context[key as keyof PersonalConnectorRuntimeContext] !== undefined,
  );

  if (leakedKeys.length > 0) {
    throw new Error(
      `Personal connector credential material cannot enter agent runtime: ${leakedKeys.join(", ")}`,
    );
  }
};

export interface RetrievePersonalConnectorSnippetsInput {
  grant: PersonalConnectorGrant;
  query: string;
  now: string;
  sourceItems: PersonalConnectorSourceItem[];
  requestedItems?: number;
}

const ensureGrantUsable = (
  grant: PersonalConnectorGrant,
  now: string,
  requestedItems: number,
): void => {
  if (grant.status !== "active")
    throw new Error("Personal connector grant is revoked");
  if (grant.accessMode !== "read_only")
    throw new Error("Personal connector grant is not read-only");
  if (new Date(now).getTime() > new Date(grant.expiresAt).getTime()) {
    throw new Error("Personal connector grant is expired");
  }
  if (requestedItems > grant.maxItems) {
    throw new Error(
      `Personal connector request exceeds grant maxItems ${grant.maxItems}`,
    );
  }
};

export const retrievePersonalConnectorSnippets = (
  input: RetrievePersonalConnectorSnippetsInput,
): PersonalConnectorRetrieval => {
  const requestedItems =
    input.requestedItems ??
    Math.min(input.sourceItems.length, input.grant.maxItems);
  ensureGrantUsable(input.grant, input.now, requestedItems);

  const selected = input.sourceItems.slice(0, requestedItems);
  const snippets = selected.map<PersonalConnectorSnippet>((item) => ({
    itemId: item.itemId,
    title: item.title,
    snippet: item.snippet.slice(0, 500),
    sourceUriHash: item.sourceUri ? sha256(item.sourceUri) : undefined,
    receivedAt: item.receivedAt,
    labels: item.labels,
  }));
  const sourceItemHashes = selected.map((item) =>
    sha256(canonicalJson(asJson(item))),
  );
  const retrievalSeed = {
    schemaVersion: "onecomputer.personal-connector-retrieval.v1",
    grantHash: input.grant.grantHash,
    connectorId: input.grant.connectorId,
    connectorKind: input.grant.connectorKind,
    agentId: input.grant.agentId,
    purpose: input.grant.purpose,
    query: input.query,
    returnedItems: snippets.length,
    snippetHashes: snippets.map((snippet) =>
      sha256(canonicalJson(asJson(snippet))),
    ),
    sourceItemHashes,
  };
  const retrievalHash = sha256(canonicalJson(asJson(retrievalSeed)));

  return {
    schemaVersion: "onecomputer.personal-connector-retrieval.v1",
    retrievalId: retrievalHash.slice("sha256:".length, "sha256:".length + 16),
    retrievalHash,
    grantHash: input.grant.grantHash,
    connectorId: input.grant.connectorId,
    connectorKind: input.grant.connectorKind,
    agentId: input.grant.agentId,
    purpose: input.grant.purpose,
    query: input.query,
    returnedItems: snippets.length,
    snippets,
    evidence: {
      source: "personal_connector_broker",
      rawCredentialExposedToRuntime: false,
      rawContentStored: false,
      sourceItemHashes,
    },
  };
};

export interface PersonalConnectorGrantRegistryEntry {
  grant: PersonalConnectorGrant;
  retrievals: PersonalConnectorRetrieval[];
  lastAccessedAt?: string;
}

export interface PersonalConnectorUserPrivacyConsolePayload {
  schemaVersion: "onecomputer.personal-connector-privacy-console.v1";
  generatedAt: string;
  userId: string;
  summary: {
    activeGrants: number;
    revokedGrants: number;
    connectors: number;
    totalRetrievals: number;
  };
  grants: Array<{
    grantId: string;
    grantHash: string;
    connectorId: string;
    connectorKind: PersonalConnectorKind;
    agentId: string;
    purpose: string;
    scope: PersonalConnectorScope;
    accessMode: PersonalConnectorAccessMode;
    status: PersonalConnectorGrant["status"];
    issuedAt: string;
    expiresAt: string;
    maxItems: number;
    lastAccessedAt?: string;
    retrievalCount: number;
    userActions: ["pause", "revoke", "inspect_data_used"];
    adminVisibility: "metadata_risk_evidence_only_no_raw_personal_content";
    vtiConsentTaskHints: [
      "consent/request",
      "consent/decision",
      "auth/step-up/approve-request",
    ];
  }>;
}

export class InMemoryPersonalConnectorGrantRegistry {
  private entries = new Map<string, PersonalConnectorGrantRegistryEntry>();

  putGrant(grant: PersonalConnectorGrant): PersonalConnectorGrant {
    const existing = this.entries.get(grant.grantId);
    this.entries.set(grant.grantId, {
      grant,
      retrievals: existing?.retrievals ?? [],
      lastAccessedAt: existing?.lastAccessedAt,
    });
    return grant;
  }

  upsertGrant(grant: PersonalConnectorGrant): PersonalConnectorGrant {
    return this.putGrant(grant);
  }

  revokeGrant(grantId: string): PersonalConnectorGrant {
    const existing = this.entries.get(grantId);
    if (!existing) throw new Error("Personal connector grant not found");
    const grant = revokePersonalConnectorGrant(existing.grant);
    this.entries.set(grantId, { ...existing, grant });
    return grant;
  }

  appendRetrieval(
    grantId: string,
    retrieval: PersonalConnectorRetrieval,
    accessedAt: string,
  ): PersonalConnectorRetrieval {
    const existing = this.entries.get(grantId);
    if (!existing) throw new Error("Personal connector grant not found");
    this.entries.set(grantId, {
      ...existing,
      retrievals: [...existing.retrievals, retrieval],
      lastAccessedAt: accessedAt,
    });
    return retrieval;
  }

  listEntriesForUser(userId: string): PersonalConnectorGrantRegistryEntry[] {
    return [...this.entries.values()].filter(
      (entry) => entry.grant.userId === userId,
    );
  }
}

export const buildPersonalConnectorPrivacyConsolePayload = (
  userId: string,
  entries: PersonalConnectorGrantRegistryEntry[],
  generatedAt = "2026-06-23T00:00:00.000Z",
): PersonalConnectorUserPrivacyConsolePayload => {
  const grants = entries.map((entry) => ({
    grantId: entry.grant.grantId,
    grantHash: entry.grant.grantHash,
    connectorId: entry.grant.connectorId,
    connectorKind: entry.grant.connectorKind,
    agentId: entry.grant.agentId,
    purpose: entry.grant.purpose,
    scope: entry.grant.scope,
    accessMode: entry.grant.accessMode,
    status: entry.grant.status,
    issuedAt: entry.grant.issuedAt,
    expiresAt: entry.grant.expiresAt,
    maxItems: entry.grant.maxItems,
    lastAccessedAt: entry.lastAccessedAt,
    retrievalCount: entry.retrievals.length,
    userActions: ["pause", "revoke", "inspect_data_used"] as [
      "pause",
      "revoke",
      "inspect_data_used",
    ],
    adminVisibility:
      "metadata_risk_evidence_only_no_raw_personal_content" as const,
    vtiConsentTaskHints: [
      "consent/request",
      "consent/decision",
      "auth/step-up/approve-request",
    ] as [
      "consent/request",
      "consent/decision",
      "auth/step-up/approve-request",
    ],
  }));

  return {
    schemaVersion: "onecomputer.personal-connector-privacy-console.v1",
    generatedAt,
    userId,
    summary: {
      activeGrants: grants.filter((grant) => grant.status === "active").length,
      revokedGrants: grants.filter((grant) => grant.status === "revoked")
        .length,
      connectors: new Set(grants.map((grant) => grant.connectorId)).size,
      totalRetrievals: entries.reduce(
        (count, entry) => count + entry.retrievals.length,
        0,
      ),
    },
    grants,
  };
};

export const samplePersonalConnectorRegistryPayload = () => {
  const registry = new InMemoryPersonalConnectorGrantRegistry();
  const grant = registry.upsertGrant(
    createReadOnlyPersonalConnectorGrant({
      connectorId: "gmail-personal-terence",
      connectorKind: "personal_gmail",
      userId: "user-terence",
      agentId: "agent-executive-briefing",
      purpose: "Prepare executive briefing using personal calendar context",
      scope: {
        labels: ["MFA"],
        query: "MFA documents",
        dateFrom: "2026-06-01",
        dateTo: "2026-06-23",
      },
      ttlMinutes: 30,
      maxItems: 3,
      issuedAt: "2026-06-23T07:00:00.000Z",
    }),
  );
  const retrieval = retrievePersonalConnectorSnippets({
    grant,
    query: "MFA documents",
    now: "2026-06-23T07:10:00.000Z",
    requestedItems: 1,
    sourceItems: [
      {
        itemId: "mail-1",
        title: "MFA folder update",
        snippet: "Personal reminder about the MFA review context.",
        sourceUri: "gmail://message/mail-1",
        receivedAt: "2026-06-22T08:00:00.000Z",
        labels: ["MFA"],
      },
    ],
  });
  registry.appendRetrieval(
    grant.grantId,
    retrieval,
    "2026-06-23T07:10:00.000Z",
  );

  return {
    registryKind: "in_memory_preview_not_persistent",
    privacyConsole: buildPersonalConnectorPrivacyConsolePayload(
      "user-terence",
      registry.listEntriesForUser("user-terence"),
    ),
    latestRetrieval: retrieval,
  };
};

export interface PersonalConnectorGrantStore {
  putGrant(grant: PersonalConnectorGrant): PersonalConnectorGrant;
  revokeGrant(grantId: string): PersonalConnectorGrant;
  appendRetrieval(
    grantId: string,
    retrieval: PersonalConnectorRetrieval,
    accessedAt: string,
  ): PersonalConnectorRetrieval;
  listEntriesForUser(userId: string): PersonalConnectorGrantRegistryEntry[];
}

export interface PersonalConnectorEvidenceExport {
  schemaVersion: "onecomputer.personal-connector-evidence-export.v1";
  exportId: string;
  exportHash: string;
  generatedAt: string;
  userId: string;
  adminView: "metadata_risk_evidence_only_no_raw_personal_content";
  grants: Array<{
    grantId: string;
    grantHash: string;
    connectorId: string;
    connectorKind: PersonalConnectorKind;
    agentId: string;
    purpose: string;
    status: PersonalConnectorGrant["status"];
    retrievalHashes: string[];
    sourceItemHashes: string[];
  }>;
}

export interface BuildPersonalConnectorEvidenceExportOptions {
  generatedAt?: string;
  includeRawPersonalContent?: boolean;
}

export const buildPersonalConnectorEvidenceExport = (
  userId: string,
  entries: PersonalConnectorGrantRegistryEntry[],
  options: BuildPersonalConnectorEvidenceExportOptions = {},
): PersonalConnectorEvidenceExport => {
  if (options.includeRawPersonalContent) {
    throw new Error(
      "Admin evidence export cannot include raw personal content without a separate incident/legal access process",
    );
  }

  const generatedAt = options.generatedAt ?? "2026-06-23T00:00:00.000Z";
  const grants = entries.map((entry) => ({
    grantId: entry.grant.grantId,
    grantHash: entry.grant.grantHash,
    connectorId: entry.grant.connectorId,
    connectorKind: entry.grant.connectorKind,
    agentId: entry.grant.agentId,
    purpose: entry.grant.purpose,
    status: entry.grant.status,
    retrievalHashes: entry.retrievals.map(
      (retrieval) => retrieval.retrievalHash,
    ),
    sourceItemHashes: entry.retrievals.flatMap(
      (retrieval) => retrieval.evidence.sourceItemHashes,
    ),
  }));
  const exportSeed = {
    schemaVersion: "onecomputer.personal-connector-evidence-export.v1" as const,
    generatedAt,
    userId,
    adminView: "metadata_risk_evidence_only_no_raw_personal_content" as const,
    grants,
  };
  const exportHash = sha256(canonicalJson(asJson(exportSeed)));

  return {
    ...exportSeed,
    exportId: exportHash.slice("sha256:".length, "sha256:".length + 16),
    exportHash,
  };
};
