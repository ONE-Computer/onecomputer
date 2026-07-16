import type { Metadata } from "next";
import { PageHeader } from "@dashboard/page-header";
import { MembersContent } from "./_components/members-content";

export const metadata: Metadata = {
  title: "Members",
};

export default function MembersPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Members"
        description="Invite users and assign enterprise roles."
      />
      <MembersContent />
    </div>
  );
}
