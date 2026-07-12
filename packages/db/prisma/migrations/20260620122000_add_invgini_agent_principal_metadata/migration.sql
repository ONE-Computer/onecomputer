-- Preserve DID/VC/VTA/VTC issuance metadata mirrored from InvGini.

ALTER TABLE "invgini_agent_principals"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
