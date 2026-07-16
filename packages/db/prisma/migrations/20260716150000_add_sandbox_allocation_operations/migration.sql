ALTER TABLE "sandboxes"
ADD COLUMN "allocation_operation_id" TEXT,
ADD COLUMN "allocation_idempotency_key" TEXT;

CREATE UNIQUE INDEX "sandboxes_allocation_operation_id_key"
ON "sandboxes"("allocation_operation_id");

-- This receipt deliberately has no foreign key to sandboxes: an unknown
-- provider outcome must remain queryable even if no ownership row exists.
CREATE TABLE "sandbox_allocation_operations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sandbox_id" TEXT,
    "provider" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sandbox_allocation_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sandbox_allocation_operations_organization_id_idempotency_key_key"
ON "sandbox_allocation_operations"("organization_id", "idempotency_key");
CREATE INDEX "sandbox_allocation_operations_organization_id_status_idx"
ON "sandbox_allocation_operations"("organization_id", "status");
CREATE INDEX "sandbox_allocation_operations_sandbox_id_idx"
ON "sandbox_allocation_operations"("sandbox_id");

ALTER TABLE "sandbox_allocation_operations"
ADD CONSTRAINT "sandbox_allocation_operations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "sandbox_allocation_operations"
ADD CONSTRAINT "sandbox_allocation_operations_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "sandbox_allocation_operations"
ADD CONSTRAINT "sandbox_allocation_operations_requester_id_fkey"
FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
