import type { Metadata } from "next";
import { DeviceApprovalPrompt } from "./_components/device-approval-prompt";

export const metadata: Metadata = {
  title: "Approval request",
};

// Standalone "manager device" surface for demo beat 4b — a web stand-in for
// the manager's phone. Renders the REAL VTI step-up Trust Task envelope
// (buildApprovalStepUpNotificationEnvelope) fetched from
// GET /v1/approvals/:id/vti-notification, and lets the manager decide via
// POST /v1/approvals/:id/decide. Transport (how this would reach an actual
// phone via DIDComm) is simulated; the envelope itself is not.
export default async function DeviceApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeviceApprovalPrompt approvalId={id} />;
}
