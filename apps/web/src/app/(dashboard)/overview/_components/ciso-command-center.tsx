"use client";

import Link from "next/link";
import {
  Bot,
  BrainCircuit,
  MonitorCog,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { Skeleton } from "@onecli/ui/components/skeleton";
import { useCounts } from "@/hooks/use-counts";
import { useSandboxCounts } from "@/hooks/use-sandbox-counts";
import { useApprovalsSummary } from "@/hooks/use-approvals-summary";
import { useBlockedActivity24h } from "@/hooks/use-blocked-activity-24h";

// Render a metric value: "--" when the fetch failed (no data object), a
// Skeleton while loading, otherwise the number. This is the graceful
// degradation contract — a failed fetch never reads as 0.
const MetricValue = ({
  loading,
  failed,
  value,
}: {
  loading: boolean;
  failed: boolean;
  value: number;
}) => {
  if (loading) return <Skeleton className="h-7 w-10" />;
  if (failed) return <span className="text-lg font-semibold">--</span>;
  return <span className="text-lg font-semibold">{value}</span>;
};

export const CisoCommandCenter = () => {
  const { data: counts, isError: countsFailed } = useCounts();
  const { data: sandboxCounts, isError: sandboxFailed } = useSandboxCounts();
  const {
    data: approvals,
    isPending: approvalsLoading,
    isError: approvalsFailed,
  } = useApprovalsSummary();
  const {
    data: blocked24h,
    isPending: blockedLoading,
    isError: blockedFailed,
  } = useBlockedActivity24h();

  const agentCount = counts?.agents;
  const activeSandboxes = sandboxCounts?.running;
  const approvalsPending = approvals?.pending;

  return (
    <Card className="border-brand/30 bg-brand/5 p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-brand">
              <ShieldCheck className="size-3.5" /> CISO Command Center
            </Badge>
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Agent → computer → policy → evidence, in one view.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Live posture from the gateway: blocked requests, pending approvals,
            active sandboxes, and configured agents. No demo data.
          </p>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <Button
              size="sm"
              className="w-full justify-center sm:w-auto"
              asChild
            >
              <Link href="/agents">
                <Bot className="size-3.5" /> Agent Control
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center sm:w-auto"
              asChild
            >
              <Link href="/apps">
                <MonitorCog className="size-3.5" /> Computer Control
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center sm:w-auto"
              asChild
            >
              <Link href="/rules">
                <ScrollText className="size-3.5" /> Policy Engine
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center sm:w-auto"
              asChild
            >
              <Link href="/copilot">
                <BrainCircuit className="size-3.5" /> Copilot — future
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border bg-background p-4 text-xs sm:grid-cols-2 xl:w-[440px]">
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-muted-foreground">Blocked (24h)</p>
            <p className="mt-1">
              <MetricValue
                loading={blockedLoading}
                failed={blockedFailed}
                value={blocked24h ?? 0}
              />
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-muted-foreground">Approvals pending</p>
            <p className="mt-1">
              <MetricValue
                loading={approvalsLoading}
                failed={approvalsFailed}
                value={approvalsPending ?? 0}
              />
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-muted-foreground">Active sandboxes</p>
            <p className="mt-1">
              <MetricValue
                loading={activeSandboxes === undefined && !sandboxFailed}
                failed={sandboxFailed}
                value={activeSandboxes ?? 0}
              />
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-muted-foreground">Active agents</p>
            <p className="mt-1">
              <MetricValue
                loading={agentCount === undefined && !countsFailed}
                failed={countsFailed}
                value={agentCount ?? 0}
              />
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};
