"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import { Button } from "@onecli/ui/components/button";
import { Badge } from "@onecli/ui/components/badge";
import { sandboxesApi } from "@/lib/api/sandboxes";
import { getBridge } from "@/lib/api/approvals";
import type { ApprovalRequest } from "@/lib/api/approvals";

interface GovernedActionCardProps {
  sandboxId: string;
}

type Phase =
  | "idle"
  | "triggering"
  | "held"
  | "approving"
  | "released"
  | "denied"
  | "error";

// Poll cadence while waiting on the manager's decision.
const POLL_MS = 3000;

/**
 * Demo card for ONE-73: "Try a governed action".
 *
 * Clicking "Attempt Outlook send" drives a REAL gateway hold: the card calls
 * POST /v1/sandboxes/:id/trigger-governed-action, which fires a curl from the
 * API process THROUGH the OneComputer gateway (MITM, :10255) to
 * graph.microsoft.com/v1.0/me/sendMail with the agent's access token as proxy
 * auth. The seeded `manual_approval` rule matches, the gateway holds the
 * request (apps/gateway/src/gateway/forward.rs:449-541) and persists a durable
 * ApprovalRequest. The card then polls that approval and renders:
 *
 *   held (waiting on manager) ──▶ released (or denied)
 *
 * The card is deliberately read-only: a manager must approve from the
 * separate OpenVTC wallet, never from the ONEComputer web UI.
 *
 * Why server-side: a browser cannot speak HTTP-CONNECT proxy auth + MITM TLS to
 * the gateway cleanly (CORS, proxy headers, CA trust), and the prior card's
 * sandbox curl left HTTPS_PROXY unset so it never actually held. Doing the
 * curl server-side (where the API process can reach 127.0.0.1:10255 and trust
 * the gateway's MITM CA via curl -k) makes the hold real. The held request
 * blocks up to ~180s in the gateway; the API route fires it detached and
 * returns the approval id immediately.
 *
 * Nothing here is faked. The approval id shown is the real row the gateway
 * created; "released" means the gateway's poll saw the decision and forwarded
 * the (tokenless) request to Graph.
 */
export const GovernedActionCard = ({ sandboxId }: GovernedActionCardProps) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [message, setMessage] = useState<string>("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll the bridge approval for status transitions while held.
  const pollApproval = useCallback(
    async (id: string) => {
      try {
        const row = await getBridge(id);
        setApproval(row);
        if (row.status === "approved") {
          stopPolling();
          setPhase("released");
        } else if (row.status === "denied") {
          stopPolling();
          setPhase("denied");
        }
      } catch {
        // Transient — keep polling; the hold row may still be settling.
      }
    },
    [stopPolling],
  );

  // Start polling once we have an approval id.
  useEffect(() => {
    if (phase === "held" && approvalId && !pollRef.current) {
      void pollApproval(approvalId);
      pollRef.current = setInterval(() => {
        if (approvalId) void pollApproval(approvalId);
      }, POLL_MS);
    }
    return () => {
      // Stop polling on unmount or once we leave the held phase.
      if (phase !== "held") stopPolling();
    };
  }, [phase, approvalId, pollApproval, stopPolling]);

  const handleAttempt = async () => {
    setPhase("triggering");
    setMessage("");
    setApproval(null);
    setApprovalId(null);
    stopPolling();
    try {
      const result = await sandboxesApi.triggerGovernedAction(sandboxId);
      setApprovalId(result.approvalId);
      setPhase("held");
      setMessage(
        `Gateway hold created — request to ${result.host}${result.path} is suspended for manager review.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(`Trigger failed: ${msg}`);
      setPhase("error");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Try a governed action
          </CardTitle>
          <Badge variant="outline" className="text-xs font-normal">
            Live gateway hold
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Explainer */}
        <div className="text-sm text-muted-foreground space-y-1.5">
          <p>
            Clicking the button sends a{" "}
            <span className="font-mono text-xs">POST</span> to{" "}
            <span className="font-mono text-xs">
              graph.microsoft.com/v1.0/me/sendMail
            </span>{" "}
            <em>through the OneComputer gateway</em> (
            <span className="font-mono text-xs">:10255</span>) using the
            agent&apos;s access token as proxy auth.
          </p>
          <p className="text-xs">
            The seeded <span className="font-mono">manual_approval</span> rule
            matches → the gateway holds the request and creates a real
            ApprovalRequest you can approve here or on the Approvals page.
          </p>
        </div>

        {/* What will happen — approval pipeline */}
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1.5">
          <p className="font-semibold text-foreground">
            Pipeline (live end-to-end):
          </p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              Policy match — gateway matches the action against the{" "}
              <span className="font-mono">manual_approval</span> rule.{" "}
              <LiveBadge live label="rule seeded" />
            </li>
            <li>
              Gateway hold — risky request is suspended for review.{" "}
              <LiveBadge live label="forward.rs:449-541" />
            </li>
            <li>
              Manager step-up — ApprovalRequest persisted; manager notified.{" "}
              <LiveBadge live label="notify_api" />
            </li>
            <li>
              Approve / deny — gateway forwards or drops based on decision.{" "}
              <LiveBadge live label="approval_poll" />
            </li>
          </ol>
        </div>

        {/* CTA + state */}
        <div className="flex items-center gap-3 flex-wrap">
          {(phase === "idle" || phase === "error") && (
            <Button onClick={handleAttempt} size="sm">
              Attempt Outlook send
            </Button>
          )}
          {phase === "triggering" && (
            <Button disabled size="sm">
              Triggering hold…
            </Button>
          )}
          {phase === "held" && (
            <Badge variant="outline" className="text-sky-600">
              Awaiting separate OpenVTC Wallet approval
            </Badge>
          )}
          {phase === "approving" && (
            <Button disabled size="sm">
              Approving…
            </Button>
          )}
          {phase === "released" && (
            <Badge className="bg-emerald-500/15 text-emerald-600">
              Released
            </Badge>
          )}
          {phase === "denied" && <Badge variant="destructive">Denied</Badge>}
          {phase === "error" && <Badge variant="destructive">Error</Badge>}
          {approvalId && (
            <span className="text-xs text-muted-foreground font-mono break-all">
              approval {approvalId.slice(0, 8)}
            </span>
          )}
        </div>

        {/* Status line */}
        {phase === "held" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
            <p className="font-medium text-foreground">
              Held — waiting on manager.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The gateway is holding the request for review. Approve here or on
              the Approvals page; the gateway polls the decision and forwards
              the request on approve.
            </p>
          </div>
        )}
        {phase === "released" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
            <p className="font-medium text-emerald-600">Released.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Manager approved — the gateway forwarded the request to Graph.
              (Graph returns 401 for the tokenless demo payload; the hold +
              release is the point.)
            </p>
          </div>
        )}
        {phase === "denied" && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
            <p className="font-medium text-red-600">Denied.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The manager denied the request — the gateway dropped it.
            </p>
          </div>
        )}
        {message && phase === "error" && (
          <p className="text-xs text-red-500 break-words">{message}</p>
        )}

        {/* Live approval detail (when held/decided) */}
        {approval && (
          <div className="rounded-md bg-[#0d0d0d] p-3 overflow-x-auto">
            <pre className="text-xs text-[#d4d4d4] whitespace-pre-wrap break-words font-mono leading-relaxed">
              {JSON.stringify(
                {
                  id: approval.id,
                  status: approval.status,
                  action: approval.action,
                  requestedBy: approval.requestedBy,
                  decidedBy: approval.decidedBy,
                  createdAt: approval.createdAt,
                },
                null,
                2,
              )}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Small inline badge helper — avoids importing a heavier tooltip just for this.
const LiveBadge = ({ live, label }: { live: boolean; label: string }) => (
  <span
    className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium ${
      live ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"
    }`}
    title={live ? "Live today" : `Simulated today — ${label}`}
  >
    {live ? "LIVE" : `sim / ${label}`}
  </span>
);
