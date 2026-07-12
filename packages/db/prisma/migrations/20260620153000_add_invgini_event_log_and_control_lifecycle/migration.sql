-- Event-log-backed truth layer for InvGini Trust Flight Recorder and durable control lifecycle.

ALTER TABLE "invgini_agent_control_actions"
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolved_by_user_id" TEXT,
  ADD COLUMN "resolved_by_email" TEXT,
  ADD COLUMN "resolution_reason" TEXT;

CREATE INDEX "invgini_agent_control_actions_expires_at_idx"
  ON "invgini_agent_control_actions"("expires_at");

CREATE TABLE "invgini_agent_event_logs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "principal_id" TEXT,
  "principal_did" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_hash" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB NOT NULL,
  "vti_bridge" JSONB,

  CONSTRAINT "invgini_agent_event_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invgini_agent_event_logs_project_id_event_hash_key"
  ON "invgini_agent_event_logs"("project_id", "event_hash");

CREATE INDEX "invgini_agent_event_logs_organization_id_occurred_at_idx"
  ON "invgini_agent_event_logs"("organization_id", "occurred_at");

CREATE INDEX "invgini_agent_event_logs_principal_did_occurred_at_idx"
  ON "invgini_agent_event_logs"("principal_did", "occurred_at");

CREATE INDEX "invgini_agent_event_logs_event_type_idx"
  ON "invgini_agent_event_logs"("event_type");

ALTER TABLE "invgini_agent_event_logs"
  ADD CONSTRAINT "invgini_agent_event_logs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
