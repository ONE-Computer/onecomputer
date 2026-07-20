ALTER TABLE governed_operations
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;

ALTER TABLE governed_operations
  ADD COLUMN IF NOT EXISTS agent_id text;

CREATE INDEX IF NOT EXISTS governed_operations_dispatch_idx
  ON governed_operations (lease_id, dispatch_started_at)
  WHERE state='executing';
