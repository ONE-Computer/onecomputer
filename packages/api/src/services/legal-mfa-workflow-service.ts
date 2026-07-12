import { createHash } from "node:crypto";
import {
  buildGuardrailDecisionPreview,
  type GuardrailAction,
  type GuardrailEvidencePreview,
} from "./protective-guardrails-service";
import {
  buildMailroomEvidenceManifest,
  normalizeInboundEmailToTrustTaskPreview,
  sampleM365AgentDirectoryPayload,
  type AgentMailroomEvidenceManifest,
  type AgentMailroomTrustTaskPreview,
} from "./m365-agent-directory-service";

export type LegalMfaWorkflowStepId =
  | "mailroom_trigger"
  | "sharepoint_scan"
  | "copy_to_working_folder"
  | "annotate_review_pack"
  | "send_manager_summary";

export interface LegalMfaWorkflowStep {
  stepId: LegalMfaWorkflowStepId;
  title: string;
  action?: GuardrailAction;
  guardrail?: GuardrailEvidencePreview;
  requiredBeforeExecution: Array<
    "guardrail" | "evidence" | "vti" | "step_up" | "approval"
  >;
  executionState:
    | "allowed_preview"
    | "pending_policy"
    | "pending_approval"
    | "blocked";
}

export interface LegalMfaWorkflowContract {
  schemaVersion: "onecomputer.golden-workflow.legal-mfa-reviewer.v1";
  workflowId: "legal-mfa-reviewer-golden";
  workflowHash: string;
  agentId: string;
  agentDid: string;
  trigger: {
    trustTask: AgentMailroomTrustTaskPreview;
    evidenceManifest: AgentMailroomEvidenceManifest;
  };
  steps: LegalMfaWorkflowStep[];
  unsafeFixtures: {
    deleteSharePointFolder: GuardrailEvidencePreview;
    excessiveRead: GuardrailEvidencePreview;
  };
  outcome: {
    status: "requires_approvals_before_execution";
    managerEmailRequiresOwnerAndCompliance: true;
    destructiveSharePointActionsBlocked: true;
    autonomousReadQuotaPerHour: 10;
    noGraphOrSharePointWriteWithoutPolicy: true;
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

const agentId = "agent-legal-mfa-reviewer";
const actorId = "user-terence";

const action = (
  partial: Omit<GuardrailAction, "actorId" | "agentId">,
): GuardrailAction => ({
  actorId,
  agentId,
  ...partial,
});

const stepFromGuardrail = (
  stepId: Exclude<LegalMfaWorkflowStepId, "mailroom_trigger">,
  title: string,
  guardrail: GuardrailEvidencePreview,
): LegalMfaWorkflowStep => {
  const decision = guardrail.evaluation.decision;
  const executionState: LegalMfaWorkflowStep["executionState"] =
    decision === "block"
      ? "blocked"
      : decision === "approval_required" || decision === "step_up"
        ? "pending_approval"
        : "allowed_preview";
  const requiredBeforeExecution = Array.from(
    new Set(
      [
        "guardrail",
        guardrail.evaluation.evidenceRequired ? "evidence" : undefined,
        guardrail.vtiAdapter.trustTasks.length > 0 ? "vti" : undefined,
        decision === "step_up" ||
        guardrail.approvalDag.some((node) => node.stepUpRequired)
          ? "step_up"
          : undefined,
        guardrail.approvalDag.length > 0 ? "approval" : undefined,
      ].filter(Boolean),
    ),
  ) as LegalMfaWorkflowStep["requiredBeforeExecution"];

  return {
    stepId,
    title,
    action: guardrail.action,
    guardrail,
    requiredBeforeExecution,
    executionState,
  };
};

export const buildLegalMfaReviewerWorkflowContract =
  (): LegalMfaWorkflowContract => {
    const agent = sampleM365AgentDirectoryPayload();
    const trustTask = normalizeInboundEmailToTrustTaskPreview({
      passport: agent.passport,
      email: {
        messageId: "<legal-mfa-workflow@example.com>",
        receivedAt: "2026-06-23T09:00:00.000Z",
        rawMime:
          "From: terence.tan@example.com\nSubject: Daily MFA review\n\nPlease review new MFA folders and prepare annotated pack.",
        fromAddress: "terence.tan@example.com",
        subject: "Daily MFA review",
        bodyText: "Please review new MFA folders and prepare annotated pack.",
        attachmentNames: [],
        auth: { spf: "pass", dkim: "pass", dmarc: "pass", arc: "pass" },
      },
    });
    const evidenceManifest = buildMailroomEvidenceManifest({
      passport: agent.passport,
      trustTask,
    });

    const previousHead = evidenceManifest.manifestHash;
    const sharePointScan = buildGuardrailDecisionPreview(
      action({
        actionType: "file.read",
        sourceBoundary: "enterprise",
        targetBoundary: "runtime",
        resourceClass: "sharepoint_mfa_folder",
        connectorId: "m365-sharepoint-legal",
        count: 5,
      }),
      { previousHead, generatedAt: "2026-06-23T09:01:00.000Z" },
    );
    const copyToWorkingFolder = buildGuardrailDecisionPreview(
      action({
        actionType: "file.write",
        sourceBoundary: "runtime",
        targetBoundary: "enterprise",
        resourceClass: "sharepoint_agent_working_folder",
        connectorId: "m365-sharepoint-legal-working-copy",
        metadata: { targetFolder: "approved-agent-working-folder" },
      }),
      {
        previousHead: sharePointScan.evidenceAppendPreview.nextHead,
        generatedAt: "2026-06-23T09:02:00.000Z",
      },
    );
    const annotateReviewPack = buildGuardrailDecisionPreview(
      action({
        actionType: "file.write",
        sourceBoundary: "runtime",
        targetBoundary: "enterprise",
        resourceClass: "mfa_annotation_pack",
        connectorId: "m365-sharepoint-legal-working-copy",
        metadata: { writeMode: "annotation_only" },
      }),
      {
        previousHead: copyToWorkingFolder.evidenceAppendPreview.nextHead,
        generatedAt: "2026-06-23T09:03:00.000Z",
      },
    );
    const sendManagerSummary = buildGuardrailDecisionPreview(
      action({
        actionType: "email.send",
        sourceBoundary: "enterprise",
        targetBoundary: "enterprise",
        resourceClass: "mfa-review-summary",
        recipientClass: "manager",
        metadata: { channel: "outlook", contentMode: "summary_and_link_only" },
      }),
      {
        previousHead: annotateReviewPack.evidenceAppendPreview.nextHead,
        generatedAt: "2026-06-23T09:04:00.000Z",
      },
    );

    const deleteSharePointFolder = buildGuardrailDecisionPreview(
      action({
        actionType: "file.delete",
        sourceBoundary: "runtime",
        targetBoundary: "enterprise",
        resourceClass: "sharepoint_folder",
        connectorId: "m365-sharepoint-legal",
      }),
      { previousHead, generatedAt: "2026-06-23T09:05:00.000Z" },
    );
    const excessiveRead = buildGuardrailDecisionPreview(
      action({
        actionType: "file.read",
        sourceBoundary: "enterprise",
        targetBoundary: "runtime",
        resourceClass: "sharepoint_mfa_folder",
        connectorId: "m365-sharepoint-legal",
        count: 11,
      }),
      { previousHead, generatedAt: "2026-06-23T09:06:00.000Z" },
    );

    const unsigned = {
      schemaVersion:
        "onecomputer.golden-workflow.legal-mfa-reviewer.v1" as const,
      workflowId: "legal-mfa-reviewer-golden" as const,
      agentId: agent.passport.agentId,
      agentDid: agent.passport.did,
      trigger: { trustTask, evidenceManifest },
      steps: [
        {
          stepId: "mailroom_trigger" as const,
          title:
            "Outlook/Teams instruction becomes Mailroom Trust Task preview",
          requiredBeforeExecution: ["evidence", "vti", "guardrail"] as Array<
            "guardrail" | "evidence" | "vti" | "step_up" | "approval"
          >,
          executionState: "pending_policy" as const,
        },
        stepFromGuardrail(
          "sharepoint_scan",
          "Read up to 10 SharePoint MFA files this hour",
          sharePointScan,
        ),
        stepFromGuardrail(
          "copy_to_working_folder",
          "Copy only to approved agent working folder",
          copyToWorkingFolder,
        ),
        stepFromGuardrail(
          "annotate_review_pack",
          "Annotate review pack in working folder",
          annotateReviewPack,
        ),
        stepFromGuardrail(
          "send_manager_summary",
          "Send summary/link to manager after owner + compliance approval",
          sendManagerSummary,
        ),
      ],
      unsafeFixtures: { deleteSharePointFolder, excessiveRead },
      outcome: {
        status: "requires_approvals_before_execution" as const,
        managerEmailRequiresOwnerAndCompliance: true as const,
        destructiveSharePointActionsBlocked: true as const,
        autonomousReadQuotaPerHour: 10 as const,
        noGraphOrSharePointWriteWithoutPolicy: true as const,
      },
    };

    return {
      ...unsigned,
      workflowHash: sha256(canonicalJson(asJson(unsigned))),
    };
  };
