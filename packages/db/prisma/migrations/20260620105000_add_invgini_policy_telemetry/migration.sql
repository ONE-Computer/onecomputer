-- Policy-engine telemetry for InvGini action requests.

ALTER TABLE "invgini_agent_action_requests"
  ADD COLUMN "risk_score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "policy_signals" JSONB;
