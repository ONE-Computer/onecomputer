-- AlterTable: add scopes column (missing from prod, already exists in dev)
DO $$ BEGIN
    ALTER TABLE "ConnectedService" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
