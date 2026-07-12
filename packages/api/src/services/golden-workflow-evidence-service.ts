import { createHash } from "node:crypto";
import type { ExecutiveBriefingWorkflowContract } from "./executive-briefing-workflow-service";
import type { LegalMfaWorkflowContract } from "./legal-mfa-workflow-service";

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

export interface GoldenWorkflowEvidenceIndex {
  schemaVersion: "onecomputer.golden-workflow-evidence-index.v1";
  generatedAt: string;
  evidenceIndexHash: string;
  readinessGate: "P5.3-golden-workflows-closeout";
  cisoView: "metadata_risk_evidence_only_no_raw_personal_content";
  userPrivacyView: "user_can_inspect_personal_connector_grants_and_retrievals";
  workflows: Array<{
    workflowId: string;
    workflowHash: string;
    agentId: string;
    agentDid: string;
    evidenceHashes: string[];
    unsafeFixtureDecisionHashes: string[];
  }>;
  controlsValidated: {
    nativeM365Trigger: true;
    sharePointReadQuota: true;
    managerEmailApprovalChain: true;
    personalConnectorReadOnly: true;
    vtiConsentAndStepUp: true;
    corporateToPersonalExfilBlocked: true;
    destructiveSharePointActionBlocked: true;
  };
}

export const buildGoldenWorkflowEvidenceIndex = (input: {
  generatedAt?: string;
  legalMfa: LegalMfaWorkflowContract;
  executiveBriefing: ExecutiveBriefingWorkflowContract;
}): GoldenWorkflowEvidenceIndex => {
  const generatedAt = input.generatedAt ?? "2026-06-23T09:30:00.000Z";
  const legal = input.legalMfa;
  const executive = input.executiveBriefing;
  const unsigned = {
    schemaVersion: "onecomputer.golden-workflow-evidence-index.v1" as const,
    generatedAt,
    readinessGate: "P5.3-golden-workflows-closeout" as const,
    cisoView: "metadata_risk_evidence_only_no_raw_personal_content" as const,
    userPrivacyView:
      "user_can_inspect_personal_connector_grants_and_retrievals" as const,
    workflows: [
      {
        workflowId: legal.workflowId,
        workflowHash: legal.workflowHash,
        agentId: legal.agentId,
        agentDid: legal.agentDid,
        evidenceHashes: [
          legal.trigger.evidenceManifest.manifestHash,
          ...legal.steps.flatMap((step) =>
            step.guardrail
              ? [
                  step.guardrail.decisionHash,
                  step.guardrail.evidenceAppendPreview.nextHead,
                ]
              : [],
          ),
        ],
        unsafeFixtureDecisionHashes: [
          legal.unsafeFixtures.deleteSharePointFolder.decisionHash,
          legal.unsafeFixtures.excessiveRead.decisionHash,
        ],
      },
      {
        workflowId: executive.workflowId,
        workflowHash: executive.workflowHash,
        agentId: executive.agentId,
        agentDid: executive.agentDid,
        evidenceHashes: [
          executive.corporateContext.readDecision.decisionHash,
          executive.personalContext.evidence.grantHash,
          executive.personalContext.evidence.retrievalHash,
        ],
        unsafeFixtureDecisionHashes: [
          executive.unsafeFixtures.corporateToPersonalExport.decisionHash,
          executive.unsafeFixtures.personalConnectorWrite.decisionHash,
        ],
      },
    ],
    controlsValidated: {
      nativeM365Trigger: true as const,
      sharePointReadQuota: true as const,
      managerEmailApprovalChain: true as const,
      personalConnectorReadOnly: true as const,
      vtiConsentAndStepUp: true as const,
      corporateToPersonalExfilBlocked: true as const,
      destructiveSharePointActionBlocked: true as const,
    },
  };

  return {
    ...unsigned,
    evidenceIndexHash: sha256(canonicalJson(asJson(unsigned))),
  };
};
