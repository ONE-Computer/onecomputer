import { apiGet, apiPost } from "./client";
import type { ApprovalStepUpPayload, VtiTrustTaskEnvelope } from "@onecli/api";

// Mirrors the backend ApprovalRequest SELECT shape
// (packages/api/src/services/approval-service.ts). `context` is a free-form
// JSON object carrying the human-readable preview ({ recipient, subject, ... }).
export interface ApprovalRequest {
  id: string;
  organizationId: string;
  projectId: string | null;
  agentId: string | null;
  requestedBy: string;
  action: string;
  context: Record<string, unknown> | null;
  status: "pending" | "approved" | "denied";
  decidedBy: string | null;
  decisionComment: string | null;
  expiresAt: string; // ISO
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface ApprovalListResponse {
  items: ApprovalRequest[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ApprovalSummary {
  pending: number;
  approved24h: number;
  denied24h: number;
}

// GET /v1/approvals — list approval requests visible to the caller.
// Pass status=undefined to fetch all statuses (pending + decided).
export const list = (
  status?: "pending" | "approved" | "denied",
  limit = 50,
) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiGet<ApprovalListResponse>(`/v1/approvals${qs ? `?${qs}` : ""}`);
};

// GET /v1/approvals/summary — manager dashboard counts.
export const summary = () => apiGet<ApprovalSummary>("/v1/approvals/summary");

// ── Bridge routes (cross-org by DB id) ───────────────────────────────────
// Used by the governed-action card. The gateway creates the held
// ApprovalRequest in the demo-corp org, but the local-mode manager session is
// in a different bootstrapped org — so the org-scoped /v1/approvals/:id routes
// 404 on these holds. The /v1/approvals/bridge/:id routes resolve the row by
// its DB id across orgs (gated by normal user auth, same trust boundary as the
// shared-secret internal route). See routes/approvals.ts.
export const getBridge = (id: string) =>
  apiGet<ApprovalRequest>(`/v1/approvals/bridge/${id}`);

// Mirrors the backend getApprovalVtiNotification response
// (packages/api/src/services/approval-service.ts). `stepUpRequest` is the
// REAL VTI Trust Task envelope targeting the manager; `actorStepUp` targets
// the actor who triggered the risky action. `delivery` tracks the simulated
// local outbox handoff state (no real DIDComm/mobile transport yet).
export interface ApprovalVtiNotification {
  approvalId: string;
  stepUpRequest: VtiTrustTaskEnvelope<ApprovalStepUpPayload>;
  actorStepUp?: VtiTrustTaskEnvelope<ApprovalStepUpPayload>;
  delivery?: {
    status: "queued" | "sent_to_vti_adapter" | "failed";
    adapter:
      | "vti-outbox-local"
      | "openvtc-task-endpoint-rest"
      | "openvtc-didcomm-bridge";
    queuedAt?: string;
    sentAt?: string;
    attempts: number;
  };
}

// GET /v1/approvals/:id/vti-notification — the manager's real Trust Task
// envelope for this approval's step-up request. This is what the device
// approval page (apps/web/src/app/(device)/device/approvals/[id]/page.tsx)
// renders as the "phone" prompt.
export const getVtiNotification = (id: string) =>
  apiGet<ApprovalVtiNotification>(`/v1/approvals/${id}/vti-notification`);

// Response shape for POST /v1/approvals/:id/actor-ack (mirrors
// recordActorAck in packages/api/src/services/approval-service.ts).
export interface ActorAckResponse {
  approvalId: string;
  actorStepUp: VtiTrustTaskEnvelope<ApprovalStepUpPayload> & {
    acknowledgedAt: string;
  };
  acknowledgedAt: string;
}

// POST /v1/approvals/:id/actor-ack — the actor who triggered the held
// action confirms their own identity ("Confirm it's me"). This is the
// actor-side 2FA analogue for the demo; it does not decide the approval —
// the manager still separately approves/denies via `decide()`.
export const actorAck = (id: string) =>
  apiPost<ActorAckResponse>(`/v1/approvals/${id}/actor-ack`, {});
