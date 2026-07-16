import type { Metadata } from "next";
import { PageHeader } from "@dashboard/page-header";
import { RolesMatrix } from "./_components/roles-matrix";
import { RbacAuditPanel } from "./_components/rbac-audit-panel";

export const metadata: Metadata = {
  title: "Roles",
};

export default function RolesPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Roles"
        description="See what each role can access and do across the organization."
      />
      <RbacAuditPanel />
      <RolesMatrix />
    </div>
  );
}
