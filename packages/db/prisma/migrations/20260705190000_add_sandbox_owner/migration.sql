-- CreateTable
CREATE TABLE "sandboxes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_sandbox_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sandboxes_organization_id_idx" ON "sandboxes"("organization_id");

-- CreateIndex
CREATE INDEX "sandboxes_owner_id_idx" ON "sandboxes"("owner_id");

-- AddForeignKey
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- AddForeignKey
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
