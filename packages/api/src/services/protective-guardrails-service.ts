import { createHash } from "node:crypto";

export const GUARDRAIL_ACTION_TYPES = [
  "email.send",
  "file.read",
  "file.delete",
  "file.export",
  "file.write",
  "secret.release",
  "connector.read",
  "connector.write",
  "network.egress",
  "runtime.code_execute",
  "policy.change",
] as const;

export type GuardrailActionType = (typeof GUARDRAIL_ACTION_TYPES)[number];

export type GuardrailBoundary =
  | "enterprise"
  | "personal"
  | "external"
  | "runtime"
  | "policy";

export type GuardrailEffect =
  | "allow"
  | "evidence_required"
  | "quota"
  | "step_up"
  | "approval_required"
  | "block";

export type GuardrailLayer = "global" | "personal" | "agent";

export interface GuardrailAction {
  actionType: GuardrailActionType;
  actorId: string;
  agentId: string;
  sourceBoundary: GuardrailBoundary;
  targetBoundary: GuardrailBoundary;
  resourceClass: string;
  connectorId?: string;
  recipientClass?: "self" | "internal" | "manager" | "external";
  count?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface GuardrailQuota {
  maxCount: number;
  window: "minute" | "hour" | "day";
}

export interface GuardrailApprovalRequirement {
  roles: Array<
    "owner" | "manager" | "compliance" | "cyber" | "data_steward" | "recipient"
  >;
  mode: "all" | "any";
  stepUpRequired?: boolean;
}

export interface GuardrailRule {
  id: string;
  title: string;
  layer: GuardrailLayer;
  effect: GuardrailEffect;
  actionTypes?: GuardrailActionType[];
  sourceBoundaries?: GuardrailBoundary[];
  targetBoundaries?: GuardrailBoundary[];
  resourceClasses?: string[];
  connectorIds?: string[];
  recipientClasses?: GuardrailAction["recipientClass"][];
  quota?: GuardrailQuota;
  approval?: GuardrailApprovalRequirement;
  reason: string;
}

export interface GuardrailEvaluation {
  decision: GuardrailEffect;
  matchedRules: GuardrailRule[];
  requiredApprovals: GuardrailApprovalRequirement[];
  quota?: GuardrailQuota;
  quotaExceeded: boolean;
  evidenceRequired: boolean;
  explanation: string;
  vtiTrustTaskHints: string[];
}

const effectRank: Record<GuardrailEffect, number> = {
  allow: 0,
  evidence_required: 10,
  quota: 20,
  step_up: 30,
  approval_required: 40,
  block: 50,
};

const effectToTrustTaskHint: Record<GuardrailEffect, string[]> = {
  allow: ["policy/evaluate"],
  evidence_required: ["policy/evaluate"],
  quota: ["policy/evaluate"],
  step_up: ["auth/step-up/approve-request", "auth/step-up/approve-response"],
  approval_required: [
    "confirm/request",
    "confirm/response",
    "auth/step-up/approve-request",
    "auth/step-up/approve-response",
  ],
  block: ["policy/evaluate"],
};

const intersects = <T>(allowed: T[] | undefined, actual: T | undefined) =>
  !allowed || actual === undefined || allowed.includes(actual);

const matchesSet = <T>(allowed: T[] | undefined, actual: T) =>
  !allowed || allowed.includes(actual);

export const ruleMatchesAction = (
  rule: GuardrailRule,
  action: GuardrailAction,
): boolean => {
  if (!matchesSet(rule.actionTypes, action.actionType)) return false;
  if (!matchesSet(rule.sourceBoundaries, action.sourceBoundary)) return false;
  if (!matchesSet(rule.targetBoundaries, action.targetBoundary)) return false;
  if (!intersects(rule.recipientClasses, action.recipientClass)) return false;

  if (rule.resourceClasses && !rule.resourceClasses.includes("*")) {
    if (!rule.resourceClasses.includes(action.resourceClass)) return false;
  }

  if (rule.connectorIds && !rule.connectorIds.includes("*")) {
    if (
      !action.connectorId ||
      !rule.connectorIds.includes(action.connectorId)
    ) {
      return false;
    }
  }

  return true;
};

const strongestEffect = (rules: GuardrailRule[]): GuardrailEffect => {
  if (rules.length === 0) return "allow";
  return rules.reduce<GuardrailEffect>(
    (current, rule) =>
      effectRank[rule.effect] > effectRank[current] ? rule.effect : current,
    "allow",
  );
};

export const evaluateGuardrails = (
  action: GuardrailAction,
  rules: GuardrailRule[],
): GuardrailEvaluation => {
  const matchedRules = rules.filter((rule) => ruleMatchesAction(rule, action));
  const strongestMatchedEffect = strongestEffect(matchedRules);
  const requiredApprovals = matchedRules
    .filter((rule) => rule.approval)
    .map((rule) => rule.approval!);
  const quota = matchedRules
    .filter((rule) => rule.quota)
    .sort((a, b) => a.quota!.maxCount - b.quota!.maxCount)
    .at(0)?.quota;
  const quotaExceeded =
    quota !== undefined &&
    action.count !== undefined &&
    action.count > quota.maxCount;
  const decision: GuardrailEffect = quotaExceeded
    ? "block"
    : strongestMatchedEffect;
  const evidenceRequired = matchedRules.some(
    (rule) => rule.effect !== "allow" || rule.layer === "global",
  );
  const vtiTrustTaskHints = Array.from(
    new Set(matchedRules.flatMap((rule) => effectToTrustTaskHint[rule.effect])),
  );

  return {
    decision,
    matchedRules,
    requiredApprovals,
    quota,
    quotaExceeded,
    evidenceRequired,
    explanation:
      quotaExceeded && quota
        ? `Quota breach: action count ${action.count} exceeds ${quota.maxCount}/${quota.window}; strictest-wins decision block.`
        : matchedRules.length === 0
          ? "No guardrail matched; default allow for this POC layer. Production tenants should install global defaults."
          : `Strictest-wins decision ${decision} from ${matchedRules
              .map((rule) => `${rule.layer}:${rule.id}`)
              .join(", ")}.`,
    vtiTrustTaskHints,
  };
};

export const defaultProtectiveGuardrails: GuardrailRule[] = [
  {
    id: "GLOBAL-EMAIL-EXT-2FA",
    title: "External email requires step-up",
    layer: "global",
    effect: "step_up",
    actionTypes: ["email.send"],
    targetBoundaries: ["external"],
    reason:
      "Outbound external email can leak regulated or corporate data and requires fresh user intent.",
  },
  {
    id: "GLOBAL-BOSS-EMAIL-APPROVAL",
    title: "Email to manager requires owner and compliance approval",
    layer: "global",
    effect: "approval_required",
    actionTypes: ["email.send"],
    recipientClasses: ["manager"],
    approval: {
      roles: ["owner", "compliance"],
      mode: "all",
      stepUpRequired: true,
    },
    reason:
      "Manager-facing communication from an AI coworker has reputational and authority risk.",
  },
  {
    id: "GLOBAL-FILE-READ-10-HOUR",
    title: "Limit autonomous file reads",
    layer: "global",
    effect: "quota",
    actionTypes: ["file.read", "connector.read"],
    quota: { maxCount: 10, window: "hour" },
    reason:
      "Throttle autonomous data access to reduce blast radius and make abnormal behavior visible.",
  },
  {
    id: "GLOBAL-SHAREPOINT-DELETE-BLOCK",
    title: "Block destructive file delete by default",
    layer: "global",
    effect: "block",
    actionTypes: ["file.delete"],
    resourceClasses: ["sharepoint_folder", "regulated_workspace", "*"],
    reason:
      "Folder deletion is destructive and should not be granted to autonomous agents in the pilot.",
  },
  {
    id: "GLOBAL-CORP-TO-PERSONAL-BLOCK",
    title: "Block corporate-to-personal exfiltration",
    layer: "global",
    effect: "block",
    sourceBoundaries: ["enterprise"],
    targetBoundaries: ["personal"],
    reason:
      "Corporate data must not be copied to personal connectors or personal accounts.",
  },
  {
    id: "GLOBAL-PERSONAL-CONNECTOR-READONLY",
    title: "Personal connectors are read-only by default",
    layer: "global",
    effect: "block",
    actionTypes: ["connector.write"],
    targetBoundaries: ["personal"],
    reason:
      "Personal third-party connectors must start read-only until a specific signed exception exists.",
  },
  {
    id: "GLOBAL-SECRET-RELEASE-APPROVAL",
    title: "Credential or secret release requires cyber approval",
    layer: "global",
    effect: "approval_required",
    actionTypes: ["secret.release"],
    approval: {
      roles: ["cyber"],
      mode: "all",
      stepUpRequired: true,
    },
    reason:
      "Secrets must never be released into agent runtime without explicit cyber approval.",
  },
  {
    id: "GLOBAL-POLICY-WEAKENING-CYBER",
    title: "Policy weakening requires cyber approval",
    layer: "global",
    effect: "approval_required",
    actionTypes: ["policy.change"],
    approval: {
      roles: ["cyber"],
      mode: "all",
      stepUpRequired: true,
    },
    reason:
      "Global or agent policy changes can silently expand authority and require explicit review.",
  },
];

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalGuardrailJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalGuardrailJson(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const item = value[key];
        if (item === undefined) {
          throw new Error(`Cannot canonicalize undefined JSON key: ${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalGuardrailJson(item)}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const guardrailSha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export interface GuardrailApprovalNode {
  nodeId: string;
  role: GuardrailApprovalRequirement["roles"][number];
  mode: GuardrailApprovalRequirement["mode"];
  stepUpRequired: boolean;
  status: "pending";
}

export interface GuardrailEvidencePreview {
  schemaVersion: "onecomputer.guardrail-decision.preview.v1";
  generatedAt: string;
  decisionId: string;
  decisionHash: string;
  actionDigest: string;
  action: GuardrailAction;
  evaluation: GuardrailEvaluation;
  approvalDag: GuardrailApprovalNode[];
  enforcement: "simulator_only_not_enforced";
  evidenceAppendPreview: {
    previousHead: string;
    decisionEventHash: string;
    nextHead: string;
    appendMode: "after_enforcement_or_human_decision";
  };
  vtiAdapter: {
    trustTasks: string[];
    note: "Trust Task names are adapter hints only; VTI/OpenVTC performs real proof/signature flows.";
  };
}

export interface GuardrailDecisionPreviewOptions {
  generatedAt?: string;
  previousHead?: string;
  rules?: GuardrailRule[];
}

const approvalDagFromEvaluation = (
  evaluation: GuardrailEvaluation,
): GuardrailApprovalNode[] =>
  evaluation.requiredApprovals.flatMap((approval, approvalIndex) =>
    approval.roles.map((role, roleIndex) => ({
      nodeId: `approval-${approvalIndex + 1}-${roleIndex + 1}-${role}`,
      role,
      mode: approval.mode,
      stepUpRequired: approval.stepUpRequired === true,
      status: "pending" as const,
    })),
  );

export const buildGuardrailDecisionPreview = (
  action: GuardrailAction,
  options: GuardrailDecisionPreviewOptions = {},
): GuardrailEvidencePreview => {
  const generatedAt = options.generatedAt ?? "2026-06-23T00:00:00.000Z";
  const previousHead =
    options.previousHead ?? "sha256:previous-evidence-head-placeholder";
  const evaluation = evaluateGuardrails(
    action,
    options.rules ?? defaultProtectiveGuardrails,
  );
  const actionDigest = guardrailSha256(
    canonicalGuardrailJson(action as unknown as JsonValue),
  );
  const decisionSeed = JSON.parse(
    JSON.stringify({
      schemaVersion: "onecomputer.guardrail-decision.preview.v1",
      generatedAt,
      actionDigest,
      decision: evaluation.decision,
      matchedRuleIds: evaluation.matchedRules.map((rule) => rule.id),
      quota: evaluation.quota ?? null,
      requiredApprovals: evaluation.requiredApprovals,
      quotaExceeded: evaluation.quotaExceeded,
      evidenceRequired: evaluation.evidenceRequired,
    }),
  ) as JsonValue;
  const decisionHash = guardrailSha256(canonicalGuardrailJson(decisionSeed));
  const decisionEventHash = guardrailSha256(
    canonicalGuardrailJson({ previousHead, decisionHash } satisfies JsonValue),
  );
  const nextHead = guardrailSha256(
    canonicalGuardrailJson({
      previousHead,
      decisionEventHash,
    } satisfies JsonValue),
  );

  return {
    schemaVersion: "onecomputer.guardrail-decision.preview.v1",
    generatedAt,
    decisionId: decisionHash.slice("sha256:".length, "sha256:".length + 16),
    decisionHash,
    actionDigest,
    action,
    evaluation,
    approvalDag: approvalDagFromEvaluation(evaluation),
    enforcement: "simulator_only_not_enforced",
    evidenceAppendPreview: {
      previousHead,
      decisionEventHash,
      nextHead,
      appendMode: "after_enforcement_or_human_decision",
    },
    vtiAdapter: {
      trustTasks:
        evaluation.vtiTrustTaskHints.length > 0
          ? evaluation.vtiTrustTaskHints
          : ["policy/evaluate"],
      note: "Trust Task names are adapter hints only; VTI/OpenVTC performs real proof/signature flows.",
    },
  };
};

export const sampleGuardrailActions: Record<string, GuardrailAction> = {
  externalEmail: {
    actionType: "email.send",
    actorId: "user-terence",
    agentId: "agent-legal-mfa-reviewer",
    sourceBoundary: "enterprise",
    targetBoundary: "external",
    resourceClass: "mfa-review-draft",
    recipientClass: "external",
  },
  managerEmail: {
    actionType: "email.send",
    actorId: "user-terence",
    agentId: "agent-legal-mfa-reviewer",
    sourceBoundary: "enterprise",
    targetBoundary: "enterprise",
    resourceClass: "mfa-review-draft",
    recipientClass: "manager",
  },
  personalConnectorWrite: {
    actionType: "connector.write",
    actorId: "user-terence",
    agentId: "agent-executive-briefing",
    sourceBoundary: "runtime",
    targetBoundary: "personal",
    resourceClass: "personal_gmail",
    connectorId: "gmail-personal",
  },
  corporateToPersonalExport: {
    actionType: "file.export",
    actorId: "user-terence",
    agentId: "agent-executive-briefing",
    sourceBoundary: "enterprise",
    targetBoundary: "personal",
    resourceClass: "board_pack",
  },
};

export const sampleGuardrailSimulatorPayload = () => ({
  schemaVersion: "onecomputer.guardrail-simulator.sample.v1",
  generatedAt: "2026-06-23T00:00:00.000Z",
  note: "Simulator-only payload. Enforcement hooks, persisted audit, and VTI proofs land in later P1/P3 slices.",
  samples: Object.entries(sampleGuardrailActions).map(([name, action]) => ({
    name,
    preview: buildGuardrailDecisionPreview(action),
  })),
});
