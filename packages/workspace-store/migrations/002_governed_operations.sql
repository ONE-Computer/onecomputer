CREATE TABLE IF NOT EXISTS governed_operations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  server_name text NOT NULL,
  tool_name text NOT NULL,
  schema_id text NOT NULL,
  arguments_json jsonb NOT NULL,
  operation_digest text NOT NULL CHECK (length(operation_digest) = 64),
  nonce uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('approval_required','approved','executing','succeeded','denied','failed','expired')),
  policy_decision text NOT NULL CHECK (policy_decision IN ('approval_required','deny')),
  safe_summary text NOT NULL,
  resource_name text NOT NULL,
  resource_location text NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  lease_id uuid UNIQUE,
  lease_expires_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id, subject_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS governed_approvals (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES governed_operations(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approve','deny')),
  channel text NOT NULL CHECK (channel = 'local-fixture'),
  issuer text NOT NULL,
  key_id text NOT NULL,
  operation_digest text NOT NULL CHECK (length(operation_digest) = 64),
  nonce uuid NOT NULL,
  proof_hash text NOT NULL CHECK (length(proof_hash) = 64),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governed_receipts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES governed_operations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status = 'succeeded'),
  upstream_reference text NOT NULL,
  result_summary text NOT NULL,
  result_hash text NOT NULL CHECK (length(result_hash) = 64),
  executed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governed_operation_events (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES governed_operations(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  correlation_id text NOT NULL,
  safe_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governed_operations_owner_recent_idx
  ON governed_operations (tenant_id, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS governed_operations_workspace_idx
  ON governed_operations (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS governed_operations_expiry_idx
  ON governed_operations (expires_at) WHERE state IN ('approval_required','approved','executing');
