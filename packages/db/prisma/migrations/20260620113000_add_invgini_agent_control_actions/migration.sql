-- Durable SecOps/admin control intents for InvGini external agents.

CREATE TABLE "invgini_agent_control_actions" (
  "id" TEXT NOT NULL,
  "principal_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reason" TEXT NOT NULL,
  "connector" TEXT,
  "resource" JSONB NOT NULL DEFAULT '{}',
  "requested_by_user_id" TEXT NOT NULL,
  "requested_by_email" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "invgini_agent_control_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invgini_agent_control_actions_principal_id_idx" ON "invgini_agent_control_actions"("principal_id");
CREATE INDEX "invgini_agent_control_actions_action_idx" ON "invgini_agent_control_actions"("action");
CREATE INDEX "invgini_agent_control_actions_status_idx" ON "invgini_agent_control_actions"("status");

ALTER TABLE "invgini_agent_control_actions"
  ADD CONSTRAINT "invgini_agent_control_actions_principal_id_fkey"
  FOREIGN KEY ("principal_id") REFERENCES "invgini_agent_principals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
