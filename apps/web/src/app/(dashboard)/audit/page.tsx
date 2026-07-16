import type { Metadata } from "next";
import { PageHeader } from "@dashboard/page-header";
import { AuditTimeline } from "./_components/audit-timeline";

export const metadata: Metadata = {
  title: "Audit Timeline",
};

// Server shell for the Ops/Audit evidence trail. Renders a client component
// that fetches from GET /v1/audit/timeline (packages/api/src/routes/audit.ts),
// which merges RequestLog + AuditLog + ApprovalRequest into one ordered feed.
// This is a superset of the console page's blocked-only, 24h RequestLog view —
// it does not duplicate it.
export default function AuditPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Audit Timeline"
        description="A defensible, cross-source evidence trail of gateway decisions, admin changes, and approvals."
      />
      <AuditTimeline />
    </div>
  );
}
