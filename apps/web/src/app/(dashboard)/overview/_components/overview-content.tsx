"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCounts } from "@/hooks/use-counts";
import { useSandboxCounts } from "@/hooks/use-sandbox-counts";
import { PageHeader } from "@dashboard/page-header";
import { getLandingPage, getPersonaRole } from "@/lib/role-preference";
import { ApiKeyCard } from "./api-key-card";
import { StatsCards } from "./stats-cards";
import { RecentActivityCard } from "./recent-activity-card";
import { CisoReadinessPanel } from "./ciso-readiness-panel";
import { CisoCommandCenter } from "./ciso-command-center";

export const OverviewContent = () => {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const role = getPersonaRole();
    // admin and owner use overview as home; others redirect to their landing page
    if (role !== "admin" && role !== "owner") {
      setRedirecting(true);
      router.replace(getLandingPage(role));
    }
  }, [router]);

  const { data, isPending: loading } = useCounts();
  const resourceCounts = data ?? { agents: 0, apps: 0, llms: 0, secrets: 0 };

  const { data: sandboxCounts, isPending: sandboxLoading } = useSandboxCounts();
  const sandboxes = sandboxCounts ?? { total: 0, running: 0 };

  if (redirecting) return null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        title="Overview"
        description="CISO-ready posture view for agent access, credential custody, policy enforcement, and audit evidence."
      />
      <CisoCommandCenter />
      <CisoReadinessPanel />
      <ApiKeyCard />
      <StatsCards
        agentCount={resourceCounts.agents}
        appCount={resourceCounts.apps}
        llmCount={resourceCounts.llms}
        secretCount={resourceCounts.secrets}
        sandboxCount={sandboxes.total}
        sandboxRunning={sandboxes.running}
        sandboxLoading={sandboxLoading}
        loading={loading}
      />
      <RecentActivityCard />
    </div>
  );
};
