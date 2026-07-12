CREATE TABLE IF NOT EXISTS "dlp_alerts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "sandbox_id" TEXT,
    "agent_id" TEXT,
    "approval_id" TEXT,
    "request_log_id" TEXT,
    "source" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "host" TEXT,
    "path" TEXT,
    "method" TEXT,
    "action" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "entity_types" JSONB NOT NULL DEFAULT '[]',
    "finding_count" INTEGER NOT NULL,
    "redacted" BOOLEAN NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "sample_hash" TEXT,
    "metadata" JSONB,
    "purview_export_status" TEXT NOT NULL DEFAULT 'pending',
    "purview_entity_guid" TEXT,
    "purview_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dlp_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dlp_alerts_organization_id_created_at_idx" ON "dlp_alerts"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "dlp_alerts_project_id_created_at_idx" ON "dlp_alerts"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "dlp_alerts_sandbox_id_idx" ON "dlp_alerts"("sandbox_id");
CREATE INDEX IF NOT EXISTS "dlp_alerts_agent_id_idx" ON "dlp_alerts"("agent_id");
CREATE INDEX IF NOT EXISTS "dlp_alerts_approval_id_idx" ON "dlp_alerts"("approval_id");
CREATE INDEX IF NOT EXISTS "dlp_alerts_purview_export_status_idx" ON "dlp_alerts"("purview_export_status");
CREATE INDEX IF NOT EXISTS "dlp_alerts_risk_level_idx" ON "dlp_alerts"("risk_level");
ALTER TABLE "dlp_alerts" ADD CONSTRAINT "dlp_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dlp_alerts" ADD CONSTRAINT "dlp_alerts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
