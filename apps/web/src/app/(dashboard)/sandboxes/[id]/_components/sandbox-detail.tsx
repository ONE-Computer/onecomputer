"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@onecli/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import type { SandboxInfo } from "@/lib/api/sandboxes";
import { sandboxesApi } from "@/lib/api/sandboxes";
import { StateBadge } from "../../_components/state-badge";
import { SandboxTerminal } from "./sandbox-terminal";
import { RemoteDesktopCard } from "./remote-desktop-card";
import { GovernedActionCard } from "./governed-action-card";
import { ActorStepUpPrompt } from "./actor-stepup-prompt";

const uptime = (createdAt?: string) => {
  if (!createdAt) return "—";
  const diff = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

export const SandboxDetail = ({ sandbox }: { sandbox: SandboxInfo }) => {
  const router = useRouter();
  const [killing, setKilling] = useState(false);

  const handleKill = async () => {
    if (!confirm(`Stop and delete sandbox "${sandbox.name}"?`)) return;
    setKilling(true);
    try {
      await sandboxesApi.delete(sandbox.id);
      router.push("/sandboxes");
    } catch {
      setKilling(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/sandboxes" className="hover:underline">
          Sandboxes
        </Link>
        <span>/</span>
        <span className="text-foreground">{sandbox.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {sandbox.name}
            </h1>
            <StateBadge state={sandbox.state} />
          </div>
          <p className="text-sm text-muted-foreground font-mono">
            {sandbox.id}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleKill}
          disabled={killing}
        >
          {killing ? "Killing…" : "Kill sandbox"}
        </Button>
      </div>

      <RemoteDesktopCard sandbox={sandbox} />

      {/* Diagnostic console card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Diagnostic command console
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-4 px-6">
          <SandboxTerminal sandboxId={sandbox.id} />
        </CardContent>
      </Card>

      {/* Governed action demo card (agent 12-D) */}
      <GovernedActionCard sandboxId={sandbox.id} />

      {/* Actor-side 2FA prompt (agent 15A-C) — shows the acting user's own
          step-up moment for a held action, separate from the manager's
          phone approval device page. */}
      <ActorStepUpPrompt sandboxId={sandbox.id} />

      {/* Detail card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">State</dt>
              <dd className="mt-1">
                <StateBadge state={sandbox.state} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Uptime</dt>
              <dd className="mt-1 text-sm font-medium">
                {uptime(
                  (sandbox as SandboxInfo & { createdAt?: string }).createdAt,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Snapshot ID</dt>
              <dd className="mt-1 text-sm font-mono text-muted-foreground truncate">
                {(sandbox as SandboxInfo & { snapshotId?: string })
                  .snapshotId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Claude version</dt>
              <dd className="mt-1 text-sm font-medium">
                {sandbox.claudeVersion ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Bootstrapped</dt>
              <dd className="mt-1 text-sm font-medium">
                {sandbox.bootstrapped ? "Yes" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Toolbox URL</dt>
              <dd className="mt-1 text-xs font-mono text-muted-foreground truncate">
                {sandbox.toolboxUrl}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
};
