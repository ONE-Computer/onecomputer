import { PageHeader } from "@dashboard/page-header";
import { ConnectionsTabs } from "../_components/connections-tabs";
import { ConnectionsCommandBrief } from "../_components/connections-command-brief";

export default function ConnectionsTabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        title="Connections"
        description="Credential and connector governance for autonomous agents."
      />
      <div className="space-y-6">
        <ConnectionsCommandBrief />
        <ConnectionsTabs />
        {children}
      </div>
    </>
  );
}
