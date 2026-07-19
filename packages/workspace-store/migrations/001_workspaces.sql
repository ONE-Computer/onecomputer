CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  grant_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('not_created','provisioning','ready','open','restarting','stopping','stopped','failed')),
  provider_id text,
  failure_code text,
  operation_token uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id, subject_id, grant_id)
);

CREATE TABLE IF NOT EXISTS workspace_idempotency (
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS workspaces_expiry_idx ON workspaces (expires_at);
