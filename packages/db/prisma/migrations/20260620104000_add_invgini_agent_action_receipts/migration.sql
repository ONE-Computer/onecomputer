-- Append-only audit receipts for InvGini autonomous agent actions.

CREATE TABLE "invgini_agent_action_receipts" (
    "id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "request_id" TEXT,
    "run_id" TEXT,
    "connector" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL,
    "receipt_hash" TEXT,
    "details" JSONB,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invgini_agent_action_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invgini_agent_action_receipts_principal_id_idx" ON "invgini_agent_action_receipts"("principal_id");
CREATE INDEX "invgini_agent_action_receipts_request_id_idx" ON "invgini_agent_action_receipts"("request_id");
CREATE INDEX "invgini_agent_action_receipts_run_id_idx" ON "invgini_agent_action_receipts"("run_id");

ALTER TABLE "invgini_agent_action_receipts" ADD CONSTRAINT "invgini_agent_action_receipts_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "invgini_agent_principals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
