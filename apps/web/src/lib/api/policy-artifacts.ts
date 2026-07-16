import { apiGet } from "./client";

export interface PolicyArtifactPreviewResponse {
  preview: PolicyArtifactPreview;
  approvalWorkflow: PolicyArtifactApprovalPreview;
  diffExport: PolicyDiffExport;
  apiSemantics: {
    deterministic: true;
    storesRawDocument: false;
    enforcement: "not_enforced";
    signer: "external_vti_or_enterprise_signer_required";
  };
}

export interface PolicyArtifactApprovalPreview {
  artifactId: string;
  artifactHash: string;
  workflowVersion: "onecomputer.policy-approval.preview.v1";
  requiredReviewerRole: "cyber_or_compliance_owner";
  currentState: "draft_review_required";
  allowedActions: ["edit", "approve", "reject"];
  evidenceAppendPreview: {
    previousHead: string;
    decisionEventHash: string;
    nextHead: string;
    appendMode: "after_human_approval";
  };
  safetyChecks: string[];
  enforcementAfterApproval: "signed_export_required_before_enforcement";
}

export interface PolicyDiffExport {
  exportId: string;
  exportHash: string;
  schemaVersion: "onecomputer.policy-diff.export.v1";
  generatedAt: string;
  artifactId: string;
  artifactHash: string;
  approvalRequired: true;
  summary: {
    block: number;
    stepUp: number;
    requireEvidence: number;
    ownerReview: number;
  };
  items: Array<{
    effect: "block" | "step_up" | "require_evidence" | "owner_review";
    count: number;
    targets: string[];
  }>;
}

export interface PolicyArtifactPreview {
  schemaVersion: "onecomputer.policy-artifact.preview.v1";
  artifactId: string;
  artifactHash: string;
  generatedAt: string;
  status: "draft_review_required";
  enforcement: "not_enforced";
  sourceDocument: {
    title: string;
    source: string;
    uploadHash: string;
    parserMode: "content_only";
    trustBoundary: "untrusted_upload";
  };
  controls: Array<{
    id: string;
    title: string;
    citation: string;
    confidence: number;
    mapsTo: {
      agents: string[];
      computers: string[];
      dataClasses: string[];
      actions: string[];
    };
    proposedEffect: "block" | "step_up" | "require_evidence" | "owner_review";
    rationale: string;
  }>;
  p3Compatibility: {
    policyArtifactHash: string;
    evidenceChainAppendMode: "after_human_approval";
    idempotencyKey: string;
  };
  reviewGate: {
    required: true;
    reviewerRole: "cyber_or_compliance_owner";
    allowedNextStates: ["edit", "approve", "reject"];
  };
  safety: {
    promptInjectionHandling: "uploaded_text_is_evidence_not_instruction";
    prohibitedClaims: string[];
    signer: "external_vti_or_enterprise_signer_required";
  };
  policyDiff: Array<{
    effect: "block" | "step_up" | "require_evidence" | "owner_review";
    count: number;
    targets: string[];
  }>;
}

export const samplePreview = () =>
  apiGet<PolicyArtifactPreviewResponse>(
    "/api/onecomputer/policy-artifacts/sample",
  );
