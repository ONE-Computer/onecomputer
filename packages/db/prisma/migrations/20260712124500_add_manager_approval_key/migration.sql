ALTER TABLE "users"
ADD COLUMN "approval_did" TEXT,
ADD COLUMN "approval_public_key_jwk" JSONB,
ADD COLUMN "approval_key_registered_at" TIMESTAMP(3);
