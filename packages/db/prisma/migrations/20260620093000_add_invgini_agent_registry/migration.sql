-- Durable registry for external InvGini-created agent principals and authority snapshots.

CREATE TABLE "invgini_agent_principals" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "trust_provider" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL DEFAULT 'agent',
    "status" TEXT NOT NULL,
    "display_name" TEXT,
    "owner_email" TEXT,
    "source_system" TEXT NOT NULL DEFAULT 'invgini',
    "source_ref_type" TEXT NOT NULL,
    "source_ref_id" TEXT NOT NULL,
    "last_event_type" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invgini_agent_principals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invgini_agent_mandates" (
    "id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invgini_agent_mandates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invgini_agent_resource_grants" (
    "id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invgini_agent_resource_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invgini_agent_action_requests" (
    "id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" JSONB NOT NULL DEFAULT '{}',
    "risk_tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invgini_agent_action_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invgini_agent_principals_project_id_did_key" ON "invgini_agent_principals"("project_id", "did");
CREATE INDEX "invgini_agent_principals_project_id_idx" ON "invgini_agent_principals"("project_id");
CREATE INDEX "invgini_agent_principals_source_ref_type_source_ref_id_idx" ON "invgini_agent_principals"("source_ref_type", "source_ref_id");
CREATE INDEX "invgini_agent_mandates_principal_id_idx" ON "invgini_agent_mandates"("principal_id");
CREATE INDEX "invgini_agent_resource_grants_principal_id_idx" ON "invgini_agent_resource_grants"("principal_id");
CREATE INDEX "invgini_agent_resource_grants_resource_type_resource_id_idx" ON "invgini_agent_resource_grants"("resource_type", "resource_id");
CREATE INDEX "invgini_agent_action_requests_principal_id_idx" ON "invgini_agent_action_requests"("principal_id");
CREATE INDEX "invgini_agent_action_requests_status_idx" ON "invgini_agent_action_requests"("status");

ALTER TABLE "invgini_agent_principals" ADD CONSTRAINT "invgini_agent_principals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invgini_agent_mandates" ADD CONSTRAINT "invgini_agent_mandates_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "invgini_agent_principals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invgini_agent_resource_grants" ADD CONSTRAINT "invgini_agent_resource_grants_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "invgini_agent_principals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invgini_agent_action_requests" ADD CONSTRAINT "invgini_agent_action_requests_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "invgini_agent_principals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
