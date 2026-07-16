import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentsLiveContent } from "./_components/agents-live-content";

export const metadata: Metadata = {
  title: "Agents",
};

export default function AgentsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <Suspense>
        <AgentsLiveContent />
      </Suspense>
    </div>
  );
}
