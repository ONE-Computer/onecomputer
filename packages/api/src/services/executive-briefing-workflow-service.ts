import { createHash } from "node:crypto";
import {
  createReadOnlyPersonalConnectorGrant,
  retrievePersonalConnectorSnippets,
  type PersonalConnectorRetrieval,
} from "./personal-connector-broker-service";
import {
  buildConsentDecisionEnvelope,
  buildPersonalConnectorConsentBinding,
  buildStepUpApprovalResponseEnvelope,
  authorizePersonalConnectorRetrievalWithVtiConsent,
  type AuthorizeRetrievalWithVtiConsentResult,
} from "./vti-consent-service";
import {
  buildGuardrailDecisionPreview,
  type GuardrailEvidencePreview,
} from "./protective-guardrails-service";

export interface PersonalContextEvidenceSummary {
  grantHash: string;
  retrievalHash: string;
  returnedItems: number;
  rawCredentialExposedToRuntime: false;
  rawContentStored: false;
  sourceItemHashes: string[];
}

export interface ExecutiveBriefingWorkflowContract {
  schemaVersion: "onecomputer.golden-workflow.executive-briefing.v1";
  workflowId: "executive-briefing-personal-context-golden";
  workflowHash: string;
  agentId: "agent-executive-briefing";
  agentDid: string;
  corporateContext: {
    readDecision: GuardrailEvidencePreview;
    sourceBoundary: "enterprise";
  };
  personalContext: {
    connectorKind: "personal_gmail";
    accessMode: "read_only";
    vtiAuthorization: AuthorizeRetrievalWithVtiConsentResult;
    evidence: PersonalContextEvidenceSummary;
  };
  outputPolicy: {
    allowedOutputMode: "summary_with_source_hashes_only";
    userCanInspectPersonalDataUsed: true;
    cisoView: "metadata_risk_evidence_only_no_raw_personal_content";
  };
  unsafeFixtures: {
    corporateToPersonalExport: GuardrailEvidencePreview;
    personalConnectorWrite: GuardrailEvidencePreview;
  };
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

const summarizeRetrieval = (
  retrieval: PersonalConnectorRetrieval,
): PersonalContextEvidenceSummary => ({
  grantHash: retrieval.grantHash,
  retrievalHash: retrieval.retrievalHash,
  returnedItems: retrieval.returnedItems,
  rawCredentialExposedToRuntime:
    retrieval.evidence.rawCredentialExposedToRuntime,
  rawContentStored: retrieval.evidence.rawContentStored,
  sourceItemHashes: retrieval.evidence.sourceItemHashes,
});

export const buildExecutiveBriefingWorkflowContract =
  (): ExecutiveBriefingWorkflowContract => {
    const agentId = "agent-executive-briefing" as const;
    const agentDid = "did:example:onecomputer:agent:executive-briefing";
    const corporateRead = buildGuardrailDecisionPreview(
      {
        actionType: "file.read",
        actorId: "user-terence",
        agentId,
        sourceBoundary: "enterprise",
        targetBoundary: "runtime",
        resourceClass: "board_and_calendar_briefing_inputs",
        connectorId: "m365-sharepoint-executive-pack",
        count: 3,
      },
      { generatedAt: "2026-06-23T09:15:00.000Z" },
    );

    const grant = createReadOnlyPersonalConnectorGrant({
      connectorId: "gmail-personal-terence",
      connectorKind: "personal_gmail",
      userId: "user-terence",
      agentId,
      purpose: "Prepare executive briefing using personal context",
      scope: { query: "MFA board preparation", labels: ["MFA"] },
      ttlMinutes: 20,
      maxItems: 2,
      issuedAt: "2026-06-23T09:10:00.000Z",
    });
    const binding = buildPersonalConnectorConsentBinding({
      grant,
      requesterDid: "did:example:onecomputer:user:terence",
      subjectDid: "did:example:onecomputer:user:terence",
      agentDid,
      requestedActionDigest: corporateRead.actionDigest,
      createdAt: "2026-06-23T09:11:00.000Z",
    });
    const decision = buildConsentDecisionEnvelope({
      consentRequest: binding.consentRequest,
      approverDid: "did:example:onecomputer:user:terence",
      approved: true,
      approvedAt: "2026-06-23T09:12:00.000Z",
      expiresAt: "2026-06-23T09:30:00.000Z",
    });
    const stepUp = buildStepUpApprovalResponseEnvelope({
      consentRequest: binding.consentRequest,
      stepUpRequest: binding.stepUpRequest,
      approverDid: "did:example:onecomputer:user:terence",
      approved: true,
      approvedAt: "2026-06-23T09:12:30.000Z",
      expiresAt: "2026-06-23T09:20:00.000Z",
      assuranceLevel: "aal2",
      method: "vta_mobile",
    });
    const vtiAuthorization = authorizePersonalConnectorRetrievalWithVtiConsent({
      grant,
      consentRequest: binding.consentRequest,
      consentDecision: decision,
      stepUpRequest: binding.stepUpRequest,
      stepUpResponse: stepUp,
      now: "2026-06-23T09:13:00.000Z",
    });
    const retrieval = retrievePersonalConnectorSnippets({
      grant,
      query: "MFA board preparation",
      now: "2026-06-23T09:13:00.000Z",
      requestedItems: 1,
      sourceItems: [
        {
          itemId: "mail-briefing-1",
          title: "MFA preparation reminder",
          snippet: "Personal context snippet for executive preparation only.",
          sourceUri: "gmail://message/mail-briefing-1",
          labels: ["MFA"],
          receivedAt: "2026-06-22T12:00:00.000Z",
        },
      ],
    });

    const corporateToPersonalExport = buildGuardrailDecisionPreview(
      {
        actionType: "file.export",
        actorId: "user-terence",
        agentId,
        sourceBoundary: "enterprise",
        targetBoundary: "personal",
        resourceClass: "board_pack",
        connectorId: "gmail-personal-terence",
      },
      {
        previousHead: retrieval.retrievalHash,
        generatedAt: "2026-06-23T09:16:00.000Z",
      },
    );
    const personalConnectorWrite = buildGuardrailDecisionPreview(
      {
        actionType: "connector.write",
        actorId: "user-terence",
        agentId,
        sourceBoundary: "runtime",
        targetBoundary: "personal",
        resourceClass: "personal_gmail_draft",
        connectorId: "gmail-personal-terence",
      },
      {
        previousHead: corporateToPersonalExport.evidenceAppendPreview.nextHead,
        generatedAt: "2026-06-23T09:17:00.000Z",
      },
    );

    const unsigned = {
      schemaVersion:
        "onecomputer.golden-workflow.executive-briefing.v1" as const,
      workflowId: "executive-briefing-personal-context-golden" as const,
      agentId,
      agentDid,
      corporateContext: {
        readDecision: corporateRead,
        sourceBoundary: "enterprise" as const,
      },
      personalContext: {
        connectorKind: "personal_gmail" as const,
        accessMode: "read_only" as const,
        vtiAuthorization,
        evidence: summarizeRetrieval(retrieval),
      },
      outputPolicy: {
        allowedOutputMode: "summary_with_source_hashes_only" as const,
        userCanInspectPersonalDataUsed: true as const,
        cisoView:
          "metadata_risk_evidence_only_no_raw_personal_content" as const,
      },
      unsafeFixtures: {
        corporateToPersonalExport,
        personalConnectorWrite,
      },
    };

    return {
      ...unsigned,
      workflowHash: sha256(canonicalJson(asJson(unsigned))),
    };
  };
