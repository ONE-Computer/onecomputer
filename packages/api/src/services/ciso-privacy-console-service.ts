import { samplePersonalConnectorRegistryPayload } from "./personal-connector-broker-service";
import { buildExecutiveBriefingWorkflowContract } from "./executive-briefing-workflow-service";
import { buildGoldenWorkflowEvidenceIndex } from "./golden-workflow-evidence-service";
import { buildLegalMfaReviewerWorkflowContract } from "./legal-mfa-workflow-service";

export interface OneComputerCisoUserPrivacyConsolePayload {
  schemaVersion: "onecomputer.ciso-user-privacy-console.v1";
  generatedAt: string;
  readinessGate: "P6.1-ciso-user-privacy-console-contract";
  cisoView: {
    rawPersonalContentVisible: false;
    rawCredentialVisible: false;
    agents: Array<{
      agentId: string;
      agentDid: string;
      ownerHumanId: string;
      riskTier: "high" | "critical";
      status: "active";
      workflows: string[];
      evidenceHashes: string[];
      controls: string[];
      actions: Array<
        "pause" | "revoke" | "export_evidence" | "request_incident_access"
      >;
    }>;
    personalConnectorEvidence: Array<{
      connectorKind: string;
      agentId: string;
      purpose: string;
      grantHash: string;
      retrievalHashes: string[];
      sourceItemHashes: string[];
      adminVisibility: "metadata_risk_evidence_only_no_raw_personal_content";
    }>;
  };
  userPrivacyView: {
    userId: string;
    canPauseOrRevoke: true;
    canInspectDataUsed: true;
    grants: Array<{
      grantId: string;
      grantHash: string;
      connectorId: string;
      connectorKind: string;
      agentId: string;
      purpose: string;
      status: string;
      expiresAt: string;
      dataUsed: Array<{
        retrievalHash: string;
        returnedItems: number;
        snippets: Array<{
          itemId: string;
          title: string;
          snippet: string;
          sourceUriHash?: string;
          receivedAt?: string;
          labels?: string[];
        }>;
      }>;
      userActions: Array<"pause" | "revoke" | "inspect_data_used">;
    }>;
  };
}

export const buildCisoUserPrivacyConsolePayload = (
  generatedAt = "2026-06-23T09:45:00.000Z",
): OneComputerCisoUserPrivacyConsolePayload => {
  const legalMfa = buildLegalMfaReviewerWorkflowContract();
  const executiveBriefing = buildExecutiveBriefingWorkflowContract();
  const evidenceIndex = buildGoldenWorkflowEvidenceIndex({
    legalMfa,
    executiveBriefing,
    generatedAt,
  });
  const personal = samplePersonalConnectorRegistryPayload();

  const personalConnectorEvidence = personal.privacyConsole.grants.map(
    (grant) => ({
      connectorKind: grant.connectorKind,
      agentId: grant.agentId,
      purpose: grant.purpose,
      grantHash: grant.grantHash,
      retrievalHashes: [personal.latestRetrieval.retrievalHash],
      sourceItemHashes: personal.latestRetrieval.evidence.sourceItemHashes,
      adminVisibility: grant.adminVisibility,
    }),
  );

  return {
    schemaVersion: "onecomputer.ciso-user-privacy-console.v1",
    generatedAt,
    readinessGate: "P6.1-ciso-user-privacy-console-contract",
    cisoView: {
      rawPersonalContentVisible: false,
      rawCredentialVisible: false,
      agents: [
        {
          agentId: legalMfa.agentId,
          agentDid: legalMfa.agentDid,
          ownerHumanId: "user-terence",
          riskTier: "high",
          status: "active",
          workflows: [legalMfa.workflowId],
          evidenceHashes: evidenceIndex.workflows[0]?.evidenceHashes ?? [],
          controls: [
            "native_m365_trigger",
            "sharepoint_read_quota",
            "manager_email_approval_chain",
            "destructive_sharepoint_action_blocked",
          ],
          actions: [
            "pause",
            "revoke",
            "export_evidence",
            "request_incident_access",
          ],
        },
        {
          agentId: executiveBriefing.agentId,
          agentDid: executiveBriefing.agentDid,
          ownerHumanId: "user-terence",
          riskTier: "critical",
          status: "active",
          workflows: [executiveBriefing.workflowId],
          evidenceHashes: evidenceIndex.workflows[1]?.evidenceHashes ?? [],
          controls: [
            "corporate_context_quota",
            "personal_connector_read_only",
            "vti_consent_and_step_up",
            "corporate_to_personal_exfil_blocked",
          ],
          actions: [
            "pause",
            "revoke",
            "export_evidence",
            "request_incident_access",
          ],
        },
      ],
      personalConnectorEvidence,
    },
    userPrivacyView: {
      userId: personal.privacyConsole.userId,
      canPauseOrRevoke: true,
      canInspectDataUsed: true,
      grants: personal.privacyConsole.grants.map((grant) => ({
        grantId: grant.grantId,
        grantHash: grant.grantHash,
        connectorId: grant.connectorId,
        connectorKind: grant.connectorKind,
        agentId: grant.agentId,
        purpose: grant.purpose,
        status: grant.status,
        expiresAt: grant.expiresAt,
        dataUsed: [
          {
            retrievalHash: personal.latestRetrieval.retrievalHash,
            returnedItems: personal.latestRetrieval.returnedItems,
            snippets: personal.latestRetrieval.snippets,
          },
        ],
        userActions: grant.userActions,
      })),
    },
  };
};
