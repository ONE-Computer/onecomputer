"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { cn } from "@onecli/ui/lib/utils";
import {
  getVtiNotification,
  type ApprovalVtiNotification,
} from "@/lib/api/approvals";

export interface DeviceApprovalPromptProps {
  approvalId: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; notification: ApprovalVtiNotification };

// Shortens a `sha256:...` hash (or any long hex-ish string) to a scannable
// "sha256:ab12cd34…ef56" form for the phone screen. Full value is never
// truncated in the underlying data — only in this display helper.
const shortHash = (value: string, head = 14, tail = 6) =>
  value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;

const formatCountdown = (msRemaining: number): string => {
  if (msRemaining <= 0) return "Expired";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const DeviceApprovalPrompt = ({
  approvalId,
}: DeviceApprovalPromptProps) => {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const notification = await getVtiNotification(approvalId);
      setState({ status: "ready", notification });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load",
      });
    }
  }, [approvalId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live countdown tick — the envelope's payload carries no explicit expiry
  // field itself, but the parent ApprovalRequest does; we surface it via the
  // envelope's createdAt + a fixed 24h TTL mirror for the "phone" display.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const envelope =
    state.status === "ready" ? state.notification.stepUpRequest : null;

  const expiresAt = useMemo(() => {
    if (!envelope) return null;
    // Mirrors APPROVAL_TTL_MS (24h) from approval-service.ts, applied to the
    // envelope's own createdAt since the envelope itself has no expiry field.
    const created = new Date(envelope.createdAt).getTime();
    return created + 24 * 60 * 60 * 1000;
  }, [envelope]);

  const msRemaining = expiresAt ? expiresAt - now : 0;
  const expired = expiresAt !== null && msRemaining <= 0;

  return (
    <div className="flex w-full max-w-[380px] flex-col overflow-hidden rounded-[2.5rem] border border-neutral-800 bg-neutral-900 shadow-2xl">
      {/* Phone-frame notch */}
      <div className="flex items-center justify-center py-3">
        <div className="h-1.5 w-16 rounded-full bg-neutral-700" />
      </div>

      <div className="flex flex-col gap-4 px-6 pb-8">
        <HonestyBanner />

        {state.status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-neutral-400">
            <div className="size-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
            Loading approval request…
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-red-400">{state.message}</p>
            <Button size="sm" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" && envelope && (
          <>
            <PromptHeader
              humanSummary={envelope.payload.humanSummary}
              expired={expired}
              msRemaining={msRemaining}
            />

            <EnvelopeDetails
              approvalId={approvalId}
              envelope={envelope}
              delivery={state.notification.delivery}
            />

            <ExternalWalletNotice expired={expired} />
          </>
        )}
      </div>
    </div>
  );
};

const HonestyBanner = () => (
  <div className="rounded-lg border border-sky-800/60 bg-sky-950/40 px-3 py-2 text-[11px] leading-snug text-sky-200">
    <span className="font-semibold">Read-only approval preview</span> —
    decisions are made only in the separate OpenVTC wallet. This ONEComputer
    page never receives or stores the manager signing key.
  </div>
);

const ExternalWalletNotice = ({ expired }: { expired: boolean }) => (
  <div className="rounded-2xl border border-sky-800/60 bg-sky-950/30 px-4 py-5 text-center">
    <p className="text-sm font-semibold text-sky-200">
      {expired ? "Request expired" : "OpenVTC Wallet required"}
    </p>
    <p className="mt-2 text-xs leading-relaxed text-sky-300/80">
      Open the separate VTI/OpenVTC Wallet to review and sign the approval.
      ONEComputer cannot approve or deny this request from its web UI.
    </p>
  </div>
);

const PromptHeader = ({
  humanSummary,
  expired,
  msRemaining,
}: {
  humanSummary: string;
  expired: boolean;
  msRemaining: number;
}) => (
  <div className="flex flex-col gap-1 pt-2 text-center">
    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
      Step-up approval request
    </p>
    <p className="text-lg font-semibold text-neutral-50">{humanSummary}</p>
    <Badge
      variant={expired ? "destructive" : "secondary"}
      className="mx-auto mt-1"
    >
      {expired ? "Expired" : `Expires in ${formatCountdown(msRemaining)}`}
    </Badge>
  </div>
);

const EnvelopeDetails = ({
  approvalId,
  envelope,
  delivery,
}: {
  approvalId: string;
  envelope: ApprovalVtiNotification["stepUpRequest"];
  delivery: ApprovalVtiNotification["delivery"];
}) => (
  <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 p-3 text-xs">
    <Row label="Approval" value={approvalId} />
    <Row label="Action" value={envelope.payload.action} />
    <Row label="Requester" value={envelope.requesterDid} mono />
    <Row label="Agent" value={envelope.agentDid} mono />
    <Row
      label="Action digest"
      value={shortHash(envelope.payload.requestedActionDigest)}
      mono
    />
    <Row label="Task hash" value={shortHash(envelope.taskHash)} mono />
    <Row label="Task type" value={envelope.taskType} mono />
    {delivery && (
      <Row
        label="Delivery"
        value={
          delivery.status === "sent_to_vti_adapter"
            ? `sent → ${delivery.adapter}`
            : delivery.status === "failed"
              ? `failed → ${delivery.adapter}`
              : `queued → ${delivery.adapter}`
        }
        mono
      />
    )}
  </div>
);

const Row = ({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="shrink-0 text-neutral-500">{label}</span>
    <span
      className={cn(
        "truncate text-right text-neutral-200",
        mono && "font-mono text-[11px]",
      )}
      title={value}
    >
      {value}
    </span>
  </div>
);
