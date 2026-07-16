-- VTI bridge / Trust Task metadata mirrored from InvGini without raw connector identifiers.

ALTER TABLE "invgini_agent_action_requests"
  ADD COLUMN "vti_bridge" JSONB;

ALTER TABLE "invgini_agent_action_receipts"
  ADD COLUMN "vti_bridge" JSONB;
