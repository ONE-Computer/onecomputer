-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "did" TEXT,
ADD COLUMN     "did_public_key" TEXT;

-- AlterTable
ALTER TABLE "invgini_agent_action_receipts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invgini_agent_action_requests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invgini_agent_mandates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invgini_agent_principals" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invgini_agent_resource_grants" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "agent_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decision_comment" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_idx" ON "approval_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_project_id_status_idx" ON "approval_requests"("project_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "approval_requests_requested_by_idx" ON "approval_requests"("requested_by");
