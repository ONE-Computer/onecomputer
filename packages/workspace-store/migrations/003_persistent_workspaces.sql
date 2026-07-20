DROP INDEX IF EXISTS workspaces_expiry_idx;
ALTER TABLE workspaces DROP COLUMN IF EXISTS expires_at;
