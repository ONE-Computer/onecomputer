import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@dashboard/page-header";
import { list, summary } from "@/lib/api/approvals";
import { ApprovalsContent } from "./_components/approvals-content";

export const metadata: Metadata = {
  title: "Approvals",
};

// Server component: fetches the initial approval queue + summary counts so the
// page renders with data before client hydration. The client component polls
// for live updates after mount.
export default async function ApprovalsPage() {
  // Fetch all statuses in one request; the client splits pending vs decided.
  // `list` is a relative fetch — auth travels via same-origin cookies.
  const initial = await list(undefined, 50).catch(() => ({
    items: [],
    hasMore: false,
    nextCursor: null,
  }));
  const summaryCounts = await summary().catch(() => ({
    pending: 0,
    approved24h: 0,
    denied24h: 0,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Approvals"
        description="Review and decide actions your agents want to take."
      />
      <Suspense>
        <ApprovalsContent
          initialItems={initial.items}
          summaryCounts={summaryCounts}
        />
      </Suspense>
    </div>
  );
}
