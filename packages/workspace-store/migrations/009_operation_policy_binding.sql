ALTER TABLE governed_operations
  ADD COLUMN IF NOT EXISTS policy_version_id uuid REFERENCES policy_versions(id);

ALTER TABLE governed_operations
  ADD COLUMN IF NOT EXISTS policy_hash text CHECK (policy_hash IS NULL OR length(policy_hash) = 64);

CREATE INDEX IF NOT EXISTS governed_operations_policy_binding_idx
  ON governed_operations (tenant_id, policy_version_id, agent_id)
  WHERE policy_version_id IS NOT NULL;
