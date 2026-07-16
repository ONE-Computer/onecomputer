import { createHash } from "node:crypto";

export type AgentProjectionTier =
  | "passport_only"
  | "email_gal_contact"
  | "teams_routable"
  | "executive_ai_employee";

export type AgentStatus =
  | "draft"
  | "active"
  | "suspended"
  | "revoked"
  | "expired";
export type AgentRiskTier = "low" | "medium" | "high" | "critical";

export interface M365AgentPassport {
  schemaVersion: "onecomputer.m365-agent-passport.v1";
  agentId: string;
  displayName: string;
  did: string;
  ownerHumanId: string;
  ownerEmail: string;
  reportsToHumanId: string;
  department: string;
  purpose: string;
  riskTier: AgentRiskTier;
  projectionTier: AgentProjectionTier;
  status: AgentStatus;
  routeLocalPart: string;
  agentDomain: string;
  reviewAt: string;
  policyIds: string[];
  passportHash: string;
  sourceOfTruth: "onecomputer_agent_passport";
}

export type M365ProjectionObjectType =
  | "none"
  | "exchange_mail_contact"
  | "teams_app_route"
  | "entra_user_exception";

export interface M365ProjectionPlan {
  objectType: M365ProjectionObjectType;
  emailAddress?: string;
  galVisible: boolean;
  teamsRoutable: boolean;
  mailboxCreated: boolean;
  mailboxCredentialsReachRuntime: false;
  syncMode: "no_projection" | "graph_preview_only" | "manual_admin_review";
  requiresCyberApproval: boolean;
  projectionIsRegenerable: true;
  notes: string[];
}

export interface AgentMailroomContract {
  schemaVersion: "onecomputer.agent-mailroom-contract.v1";
  agentId: string;
  agentDid: string;
  emailAddress: string;
  ingressMode:
    | "dedicated_agent_subdomain_mx"
    | "exchange_internal_relay"
    | "preview_only";
  trustTaskRequired: true;
  guardrailRequired: true;
  vtiVerificationRequired: true;
  rawMimeHandling: "hash_and_quarantine_default";
  defaultDeliveryState: "pending_policy" | "route_disabled";
  noMailboxCredentialsInRuntime: true;
  contractHash: string;
}

export interface M365AgentProjectionBundle {
  passport: M365AgentPassport;
  projections: M365ProjectionPlan[];
  mailroom: AgentMailroomContract;
  invariants: {
    sourceOfTruth: "onecomputer_agent_passport";
    microsoftObjectsAreProjections: true;
    noPerAgentMailboxByDefault: true;
    everyProjectedAgentNeedsOwnerReviewAndDid: true;
  };
}

export interface InboundMailAuthResults {
  spf: "pass" | "fail" | "neutral" | "none";
  dkim: "pass" | "fail" | "none";
  dmarc: "pass" | "fail" | "none";
  arc: "pass" | "fail" | "none";
}

export interface InboundEmailEvidenceInput {
  messageId: string;
  receivedAt: string;
  rawMime: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  attachmentNames: string[];
  auth: InboundMailAuthResults;
}

export interface AgentMailroomEvidenceManifest {
  schemaVersion: "onecomputer.agent-mailroom-evidence-manifest.v1";
  manifestHash: string;
  taskId: string;
  taskHash: string;
  agentId: string;
  agentDid: string;
  passportHash: string;
  contractHash: string;
  routeState: "active" | "disabled";
  deliveryState: "pending_policy" | "rejected_route_disabled" | "rejected_auth";
  retainedContentMode: "metadata_and_hashes_only";
  rawMimeRetainedInRuntime: false;
  sourceEvidence: AgentMailroomTrustTaskPreview["sourceEvidence"];
  requiredGates: AgentMailroomTrustTaskPreview["nextRequiredGates"];
  auditLabels: string[];
}

export interface AgentMailroomTrustTaskPreview {
  schemaVersion: "onecomputer.agent-mailroom-trust-task-preview.v1";
  taskId: string;
  taskHash: string;
  targetAgentId: string;
  targetAgentDid: string;
  requesterEmail: string;
  sourceEvidence: {
    messageId: string;
    rawMimeHash: string;
    subjectHash: string;
    bodyHash: string;
    attachmentNameHashes: string[];
  };
  mailAuthTier:
    | "unauthenticated"
    | "domain_authenticated"
    | "enrolled_sender_required";
  initialCapability: "reject" | "enroll_only" | "pending_policy";
  nextRequiredGates: Array<"agent_passport" | "guardrails" | "vti" | "step_up">;
  note: "Email is evidence, not authority. Execution is never allowed directly from mail parsing.";
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalJson = (value: JsonValue): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const emailFor = (
  passport: Pick<M365AgentPassport, "routeLocalPart" | "agentDomain">,
) => `${passport.routeLocalPart}@${passport.agentDomain}`;

const assertPassportInvariant = (
  passport: Omit<
    M365AgentPassport,
    "schemaVersion" | "passportHash" | "sourceOfTruth"
  >,
) => {
  if (!passport.did.startsWith("did:")) {
    throw new Error(
      "Agent Passport requires DID-backed identity before M365 projection",
    );
  }
  if (!passport.ownerHumanId || !passport.ownerEmail) {
    throw new Error(
      "Agent Passport requires a human owner before M365 projection",
    );
  }
  if (!passport.reportsToHumanId) {
    throw new Error(
      "Agent Passport requires reports-to metadata before M365 projection",
    );
  }
  if (!passport.reviewAt) {
    throw new Error("Agent Passport requires reviewAt before M365 projection");
  }
};

export const buildM365AgentPassport = (
  input: Omit<
    M365AgentPassport,
    "schemaVersion" | "passportHash" | "sourceOfTruth"
  >,
): M365AgentPassport => {
  assertPassportInvariant(input);
  const unsigned = {
    schemaVersion: "onecomputer.m365-agent-passport.v1" as const,
    ...input,
    sourceOfTruth: "onecomputer_agent_passport" as const,
  };
  return {
    ...unsigned,
    passportHash: sha256(canonicalJson(asJson(unsigned))),
  };
};

export const buildM365ProjectionPlans = (
  passport: M365AgentPassport,
): M365ProjectionPlan[] => {
  const address = emailFor(passport);
  if (passport.status !== "active") {
    return [
      {
        objectType: "none",
        galVisible: false,
        teamsRoutable: false,
        mailboxCreated: false,
        mailboxCredentialsReachRuntime: false,
        syncMode: "no_projection",
        requiresCyberApproval: false,
        projectionIsRegenerable: true,
        notes: ["Route disabled because agent is not active."],
      },
    ];
  }

  if (passport.projectionTier === "passport_only") {
    return [
      {
        objectType: "none",
        galVisible: false,
        teamsRoutable: false,
        mailboxCreated: false,
        mailboxCredentialsReachRuntime: false,
        syncMode: "no_projection",
        requiresCyberApproval: false,
        projectionIsRegenerable: true,
        notes: [
          "Long-tail/background agent remains visible only in OneComputer.",
        ],
      },
    ];
  }

  const contact: M365ProjectionPlan = {
    objectType: "exchange_mail_contact",
    emailAddress: address,
    galVisible: true,
    teamsRoutable: false,
    mailboxCreated: false,
    mailboxCredentialsReachRuntime: false,
    syncMode: "graph_preview_only",
    requiresCyberApproval: false,
    projectionIsRegenerable: true,
    notes: [
      "Default scalable projection: Outlook/GAL discovery without per-agent mailbox credentials.",
    ],
  };

  if (passport.projectionTier === "email_gal_contact") return [contact];

  if (passport.projectionTier === "teams_routable") {
    return [
      contact,
      {
        objectType: "teams_app_route",
        emailAddress: address,
        galVisible: true,
        teamsRoutable: true,
        mailboxCreated: false,
        mailboxCredentialsReachRuntime: false,
        syncMode: "graph_preview_only",
        requiresCyberApproval: false,
        projectionIsRegenerable: true,
        notes: [
          "Teams route should use OneComputer app/message extension search, not a full Teams user by default.",
        ],
      },
    ];
  }

  return [
    {
      objectType: "entra_user_exception",
      emailAddress: address,
      galVisible: true,
      teamsRoutable: true,
      mailboxCreated: true,
      mailboxCredentialsReachRuntime: false,
      syncMode: "manual_admin_review",
      requiresCyberApproval: true,
      projectionIsRegenerable: true,
      notes: [
        "Executive AI employee projection is a premium exception and still must not expose mailbox credentials to the runtime.",
      ],
    },
  ];
};

export const buildAgentMailroomContract = (
  passport: M365AgentPassport,
): AgentMailroomContract => {
  const base = {
    schemaVersion: "onecomputer.agent-mailroom-contract.v1" as const,
    agentId: passport.agentId,
    agentDid: passport.did,
    emailAddress: emailFor(passport),
    ingressMode: "exchange_internal_relay" as const,
    trustTaskRequired: true as const,
    guardrailRequired: true as const,
    vtiVerificationRequired: true as const,
    rawMimeHandling: "hash_and_quarantine_default" as const,
    defaultDeliveryState:
      passport.status === "active"
        ? ("pending_policy" as const)
        : ("route_disabled" as const),
    noMailboxCredentialsInRuntime: true as const,
  };
  return {
    ...base,
    contractHash: sha256(canonicalJson(asJson(base))),
  };
};

export const buildM365AgentProjectionBundle = (
  input: Parameters<typeof buildM365AgentPassport>[0],
): M365AgentProjectionBundle => {
  const passport = buildM365AgentPassport(input);
  return {
    passport,
    projections: buildM365ProjectionPlans(passport),
    mailroom: buildAgentMailroomContract(passport),
    invariants: {
      sourceOfTruth: "onecomputer_agent_passport",
      microsoftObjectsAreProjections: true,
      noPerAgentMailboxByDefault: true,
      everyProjectedAgentNeedsOwnerReviewAndDid: true,
    },
  };
};

const classifyMailAuth = (
  auth: InboundMailAuthResults,
): AgentMailroomTrustTaskPreview["mailAuthTier"] => {
  if (auth.dmarc === "pass" && (auth.dkim === "pass" || auth.spf === "pass")) {
    return "domain_authenticated";
  }
  if (auth.dkim === "pass" || auth.spf === "pass" || auth.arc === "pass") {
    return "enrolled_sender_required";
  }
  return "unauthenticated";
};

const capabilityFor = (
  tier: AgentMailroomTrustTaskPreview["mailAuthTier"],
  contract: AgentMailroomContract,
): AgentMailroomTrustTaskPreview["initialCapability"] => {
  if (contract.defaultDeliveryState === "route_disabled") return "reject";
  if (tier === "unauthenticated") return "reject";
  if (tier === "enrolled_sender_required") return "enroll_only";
  return "pending_policy";
};

export const normalizeInboundEmailToTrustTaskPreview = (input: {
  passport: M365AgentPassport;
  email: InboundEmailEvidenceInput;
}): AgentMailroomTrustTaskPreview => {
  const contract = buildAgentMailroomContract(input.passport);
  const tier = classifyMailAuth(input.email.auth);
  const evidence = {
    messageId: input.email.messageId,
    rawMimeHash: sha256(input.email.rawMime),
    subjectHash: sha256(input.email.subject),
    bodyHash: sha256(input.email.bodyText),
    attachmentNameHashes: input.email.attachmentNames.map(sha256),
  };
  const unsigned = {
    schemaVersion: "onecomputer.agent-mailroom-trust-task-preview.v1" as const,
    targetAgentId: input.passport.agentId,
    targetAgentDid: input.passport.did,
    requesterEmail: input.email.fromAddress,
    sourceEvidence: evidence,
    mailAuthTier: tier,
    initialCapability: capabilityFor(tier, contract),
    nextRequiredGates: [
      "agent_passport",
      "guardrails",
      "vti",
      "step_up",
    ] as Array<"agent_passport" | "guardrails" | "vti" | "step_up">,
    note: "Email is evidence, not authority. Execution is never allowed directly from mail parsing." as const,
  };
  const taskHash = sha256(canonicalJson(asJson(unsigned)));
  return {
    taskId: `mailroom_${taskHash.slice(7, 19)}`,
    taskHash,
    ...unsigned,
  };
};

export const buildMailroomEvidenceManifest = (input: {
  passport: M365AgentPassport;
  trustTask: AgentMailroomTrustTaskPreview;
}): AgentMailroomEvidenceManifest => {
  const contract = buildAgentMailroomContract(input.passport);
  const routeState: AgentMailroomEvidenceManifest["routeState"] =
    contract.defaultDeliveryState === "route_disabled" ? "disabled" : "active";
  const deliveryState: AgentMailroomEvidenceManifest["deliveryState"] =
    routeState === "disabled"
      ? "rejected_route_disabled"
      : input.trustTask.initialCapability === "reject"
        ? "rejected_auth"
        : "pending_policy";
  const unsigned = {
    schemaVersion: "onecomputer.agent-mailroom-evidence-manifest.v1" as const,
    taskId: input.trustTask.taskId,
    taskHash: input.trustTask.taskHash,
    agentId: input.passport.agentId,
    agentDid: input.passport.did,
    passportHash: input.passport.passportHash,
    contractHash: contract.contractHash,
    routeState,
    deliveryState,
    retainedContentMode: "metadata_and_hashes_only" as const,
    rawMimeRetainedInRuntime: false as const,
    sourceEvidence: input.trustTask.sourceEvidence,
    requiredGates: input.trustTask.nextRequiredGates,
    auditLabels: [
      "email_as_evidence_not_authority",
      "raw_mime_hash_only",
      "mailbox_credentials_never_enter_runtime",
    ],
  };
  return {
    ...unsigned,
    manifestHash: sha256(canonicalJson(asJson(unsigned))),
  };
};

export const sampleRevokedM365AgentDirectoryPayload =
  (): M365AgentProjectionBundle =>
    buildM365AgentProjectionBundle({
      agentId: "agent-retired-mfa-reviewer",
      displayName: "AI Retired MFA Reviewer",
      did: "did:example:onecomputer:agent:retired-mfa-reviewer",
      ownerHumanId: "user-terence",
      ownerEmail: "terence.tan@example.com",
      reportsToHumanId: "user-legal-ops-head",
      department: "Legal / Investments",
      purpose: "Retired reviewer kept for evidence lookups only.",
      riskTier: "high",
      projectionTier: "teams_routable",
      status: "revoked",
      routeLocalPart: "ai.retired-mfa-reviewer",
      agentDomain: "agents.example.com",
      reviewAt: "2026-07-23T00:00:00.000Z",
      policyIds: ["policy-agent-revoked-no-delivery"],
    });

export const sampleM365AgentDirectoryPayload = (): M365AgentProjectionBundle =>
  buildM365AgentProjectionBundle({
    agentId: "agent-legal-mfa-reviewer",
    displayName: "AI Legal MFA Reviewer",
    did: "did:example:onecomputer:agent:legal-mfa-reviewer",
    ownerHumanId: "user-terence",
    ownerEmail: "terence.tan@example.com",
    reportsToHumanId: "user-legal-ops-head",
    department: "Legal / Investments",
    purpose:
      "Review MFA documents and draft annotated summaries under owner approval.",
    riskTier: "high",
    projectionTier: "teams_routable",
    status: "active",
    routeLocalPart: "ai.legal-mfa-reviewer",
    agentDomain: "agents.example.com",
    reviewAt: "2026-07-23T00:00:00.000Z",
    policyIds: ["policy-email-external-stepup", "policy-sharepoint-read-quota"],
  });
