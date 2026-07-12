"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import { Button } from "@onecli/ui/components/button";
import { Badge } from "@onecli/ui/components/badge";
import { cn } from "@onecli/ui/lib/utils";
import { list, actorAck, type ApprovalRequest } from "@/lib/api/approvals";

// Poll cadence while waiting on the manager's decision. Matches the phone
// "device" page pattern (simulated push, no real transport yet).
const POLL_MS = 3000;

/**
 * Agent 15A-C: actor-side 2FA prompt.
 *
 * When the acting user's held action (from GovernedActionCard's "Attempt
 * Outlook send" button) creates a pending ApprovalRequest, this card polls
 * GET /v1/approvals (RBAC already scopes members to their own
 * `requestedBy` rows) and surfaces the actor's own step-up moment:
 * `context._vti.actorStepUp.humanSummary` + a "Confirm it's me" button that
 * POSTs /v1/approvals/:id/actor-ack. This is the actor's analogue to the
 * manager's phone approval — it does NOT decide the approval itself.
 *
 * Same honesty rule as the device page: envelope is real, transport is a
 * local simulation.
 *
 * Note: `sandboxId` is accepted for future correlation (e.g. once approvals
 * carry a sandboxId in context) but isn't needed for scoping today — RBAC
 * already limits GET /v1/approvals to the caller's own requests.
 */
export const ActorStepUpPrompt = ({ sandboxId }: { sandboxId: string }) => {
  void sandboxId;
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [acking, setAcking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ackedApprovalIds = useRef<Set<string>>(new Set());
  const currentApprovalId = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      // Members are RBAC-scoped to their own ApprovalRequest rows
      // (`can("read", "ApprovalRequest", { requestedBy: user.id })`), so this
      // list is already just "my pending/recent approvals" — no need to
      // filter by sandboxId client-side.
      const [pending, recent] = await Promise.all([
        list("pending", 10),
        list(undefined, 10),
      ]);

      const candidate =
        pending.items[0] ??
        recent.items.find((item) => item.id === currentApprovalId.current) ??
        recent.items[0] ??
        null;

      setApproval((prevApproval) => {
        const next = candidate ?? prevApproval;
        if (
          prevApproval &&
          next &&
          prevApproval.id === next.id &&
          prevApproval.status !== next.status
        ) {
          if (next.status === "approved") toast.success("Manager approved");
          if (next.status === "denied") toast.error("Manager denied");
        }
        currentApprovalId.current = next?.id ?? null;
        return next;
      });
    } catch {
      // Silent — this is a best-effort demo poll, not a critical path.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  if (!loaded || !approval) return null;

  const vti = approval.context?._vti as
    | {
        actorStepUp?: {
          payload?: { humanSummary?: string };
          acknowledgedAt?: string;
        };
      }
    | undefined;
  const actorStepUp = vti?.actorStepUp;
  if (!actorStepUp?.payload) return null;

  const acknowledged =
    Boolean(actorStepUp.acknowledgedAt) ||
    ackedApprovalIds.current.has(approval.id);

  const handleAck = async () => {
    setAcking(true);
    try {
      await actorAck(approval.id);
      ackedApprovalIds.current.add(approval.id);
      toast.success("Identity confirmed");
      await poll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to confirm identity",
      );
    } finally {
      setAcking(false);
    }
  };

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Your identity step-up
          </CardTitle>
          <StatusBadge status={approval.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <HonestyBanner />

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium text-foreground">
            Action held for approval.
          </p>
          <p className="mt-1 text-muted-foreground">
            {actorStepUp.payload.humanSummary}
          </p>
        </div>

        {!acknowledged ? (
          <Button onClick={handleAck} disabled={acking} size="sm">
            {acking ? "Confirming…" : "Confirm it's me"}
          </Button>
        ) : (
          <p className="text-xs text-emerald-500">
            Identity confirmed
            {actorStepUp.acknowledgedAt
              ? ` at ${new Date(actorStepUp.acknowledgedAt).toLocaleTimeString()}`
              : ""}
            .
          </p>
        )}

        <LiveStatus status={approval.status} />
      </CardContent>
    </Card>
  );
};

const HonestyBanner = () => (
  <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-300">
    <span className="font-semibold">Simulated device delivery</span> — envelope
    is cryptographically real, transport is local for demo.
  </div>
);

const StatusBadge = ({ status }: { status: ApprovalRequest["status"] }) => (
  <Badge
    variant={
      status === "approved"
        ? "default"
        : status === "denied"
          ? "destructive"
          : "secondary"
    }
    className="text-xs"
  >
    {status === "pending"
      ? "Pending"
      : status === "approved"
        ? "Approved"
        : "Denied"}
  </Badge>
);

const LiveStatus = ({ status }: { status: ApprovalRequest["status"] }) => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <span
      className={cn(
        "size-1.5 rounded-full",
        status === "pending" && "animate-pulse bg-amber-500",
        status === "approved" && "bg-emerald-500",
        status === "denied" && "bg-red-500",
      )}
    />
    {status === "pending" && "Waiting on manager…"}
    {status === "approved" && "Manager approved this action."}
    {status === "denied" && "Manager denied this action."}
  </div>
);
