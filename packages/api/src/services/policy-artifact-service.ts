import { createHash } from "node:crypto";

export interface PolicyDocumentDescriptor {
  title: string;
  source: string;
  uploadHash: string;
  parserMode: "content_only";
  trustBoundary: "untrusted_upload";
}

export interface PolicyControlCandidate {
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
}

export interface PolicyArtifactDiffItem {
  effect: PolicyControlCandidate["proposedEffect"];
  count: number;
  targets: string[];
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
  items: PolicyArtifactDiffItem[];
}

export interface PolicyArtifactPreview {
  schemaVersion: "onecomputer.policy-artifact.preview.v1";
  artifactId: string;
  artifactHash: string;
  generatedAt: string;
  status: "draft_review_required";
  enforcement: "not_enforced";
  sourceDocument: PolicyDocumentDescriptor;
  controls: PolicyControlCandidate[];
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
  policyDiff: PolicyArtifactDiffItem[];
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalizeJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const item = value[key];
        if (item === undefined) {
          throw new Error(`Cannot canonicalize undefined JSON key: ${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalizeJson(item)}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const sampleDocumentText = [
  "MFA document review standard",
  "Agents may only write inside approved MFA workspaces.",
  "High-exposure review agents require evidence heads.",
  "External disclosure requires human review.",
].join("\n");

const buildPreviewPayload = (): Omit<
  PolicyArtifactPreview,
  "artifactId" | "artifactHash" | "p3Compatibility"
> => ({
  schemaVersion: "onecomputer.policy-artifact.preview.v1",
  generatedAt: "2026-06-22T00:00:00.000Z",
  status: "draft_review_required",
  enforcement: "not_enforced",
  sourceDocument: {
    title: "MFA Document Review Standard",
    source: "Internal policy sample",
    uploadHash: sha256(sampleDocumentText),
    parserMode: "content_only",
    trustBoundary: "untrusted_upload",
  },
  controls: [
    {
      id: "POL-MFA-001",
      title: "Restrict write access to MFA workspace",
      citation: "§2.1 Workspace boundaries",
      confidence: 0.94,
      mapsTo: {
        agents: ["Legal MFA reviewer"],
        computers: ["SharePoint MFA workspace"],
        dataClasses: ["mfa-review-documents"],
        actions: ["copy", "annotate", "write"],
      },
      proposedEffect: "block",
      rationale:
        "Prevent autonomous write/copy/annotate actions outside the scoped MFA folder until a reviewer approves the boundary.",
    },
    {
      id: "POL-MFA-002",
      title: "Require evidence for high-exposure review agents",
      citation: "§3.4 Audit and evidence",
      confidence: 0.91,
      mapsTo: {
        agents: ["High exposure agents", "Legal MFA reviewer"],
        computers: ["OneComputer governed runtime"],
        dataClasses: ["regulated-work-product"],
        actions: ["autonomous_run", "export_manifest"],
      },
      proposedEffect: "require_evidence",
      rationale:
        "Require policy hash, owner mandate, and evidence-chain head before autonomous runs touch regulated work product.",
    },
    {
      id: "POL-MFA-003",
      title: "Step-up before external sharing",
      citation: "§4.2 External disclosure",
      confidence: 0.88,
      mapsTo: {
        agents: ["Builder apps", "Legal MFA reviewer"],
        computers: ["Meeting Tracker", "MFA export workspace"],
        dataClasses: ["external-share-output"],
        actions: ["share", "send", "publish"],
      },
      proposedEffect: "step_up",
      rationale:
        "Require explicit human review before external disclosure or wider export of generated work product.",
    },
  ],
  reviewGate: {
    required: true,
    reviewerRole: "cyber_or_compliance_owner",
    allowedNextStates: ["edit", "approve", "reject"],
  },
  safety: {
    promptInjectionHandling: "uploaded_text_is_evidence_not_instruction",
    prohibitedClaims: [
      "no automatic enforcement from parsed text",
      "no privilege expansion from document content",
      "no signer claim until VTI/Affinidi or enterprise signer is wired",
    ],
    signer: "external_vti_or_enterprise_signer_required",
  },
  policyDiff: [
    {
      effect: "block",
      count: 1,
      targets: ["Legal MFA reviewer write path"],
    },
    {
      effect: "step_up",
      count: 2,
      targets: ["Meeting Tracker external share", "MFA export workspace"],
    },
    {
      effect: "require_evidence",
      count: 3,
      targets: ["High exposure agents", "Legal MFA reviewer", "Builder apps"],
    },
    {
      effect: "owner_review",
      count: 2,
      targets: ["InvGini owner", "Builder owner"],
    },
  ],
});

export const generateSamplePolicyArtifactPreview =
  (): PolicyArtifactPreview => {
    const payload = buildPreviewPayload();
    const payloadForHash = payload as unknown as JsonValue;
    const artifactHash = sha256(canonicalizeJson(payloadForHash));
    const idempotencyKey = sha256(
      canonicalizeJson({
        schemaVersion: payload.schemaVersion,
        sourceDocumentHash: payload.sourceDocument.uploadHash,
        controls: payload.controls.map((control) => control.id),
      }),
    );

    return {
      ...payload,
      artifactId: `opa_${artifactHash.slice("sha256:".length, "sha256:".length + 12)}`,
      artifactHash,
      p3Compatibility: {
        policyArtifactHash: artifactHash,
        evidenceChainAppendMode: "after_human_approval",
        idempotencyKey,
      },
    };
  };

export const generateSamplePolicyApprovalPreview =
  (): PolicyArtifactApprovalPreview => {
    const preview = generateSamplePolicyArtifactPreview();
    const previousHead = sha256(`previous-head:${preview.artifactHash}`);
    const decisionPayload = {
      artifactHash: preview.artifactHash,
      decision: "approve",
      reviewerRole: preview.reviewGate.reviewerRole,
      status: preview.status,
    } as unknown as JsonValue;
    const decisionEventHash = sha256(canonicalizeJson(decisionPayload));
    const nextHead = sha256(`${previousHead}:${decisionEventHash}`);

    return {
      artifactId: preview.artifactId,
      artifactHash: preview.artifactHash,
      workflowVersion: "onecomputer.policy-approval.preview.v1",
      requiredReviewerRole: "cyber_or_compliance_owner",
      currentState: "draft_review_required",
      allowedActions: ["edit", "approve", "reject"],
      evidenceAppendPreview: {
        previousHead,
        decisionEventHash,
        nextHead,
        appendMode: "after_human_approval",
      },
      safetyChecks: [
        "reviewer must confirm source citations",
        "reviewer must confirm policy diff before export",
        "approval does not grant enforcement without signer",
        "uploaded document instructions remain content-only",
      ],
      enforcementAfterApproval: "signed_export_required_before_enforcement",
    };
  };

export const generateSamplePolicyDiffExport = (): PolicyDiffExport => {
  const preview = generateSamplePolicyArtifactPreview();
  const summary = preview.policyDiff.reduce(
    (acc, item) => {
      if (item.effect === "block") acc.block += item.count;
      if (item.effect === "step_up") acc.stepUp += item.count;
      if (item.effect === "require_evidence") acc.requireEvidence += item.count;
      if (item.effect === "owner_review") acc.ownerReview += item.count;
      return acc;
    },
    { block: 0, stepUp: 0, requireEvidence: 0, ownerReview: 0 },
  );

  const payload = {
    schemaVersion: "onecomputer.policy-diff.export.v1",
    generatedAt: preview.generatedAt,
    artifactId: preview.artifactId,
    artifactHash: preview.artifactHash,
    approvalRequired: true,
    summary,
    items: preview.policyDiff,
  } as const;
  const exportHash = sha256(canonicalizeJson(payload as unknown as JsonValue));

  return {
    exportId: `pdx_${exportHash.slice("sha256:".length, "sha256:".length + 12)}`,
    exportHash,
    ...payload,
  };
};
