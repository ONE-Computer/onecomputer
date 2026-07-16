import type { Metadata } from "next";
import { PageHeader } from "@dashboard/page-header";
import { AppsLiveContent } from "./_components/apps-live-content";

export const metadata: Metadata = {
  title: "Computer Control",
};

export default function AppsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Computer Control Pane"
        description="Generic control plane for governed app runtimes and AI computers: URLs, owners, linked agents, verifier backend, policy, evidence, and kill switches."
      />
      <AppsLiveContent />
    </div>
  );
}
