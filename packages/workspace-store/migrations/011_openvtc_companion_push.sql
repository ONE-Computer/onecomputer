DROP INDEX IF EXISTS openvtc_approvers_active_owner_idx;

CREATE INDEX IF NOT EXISTS openvtc_approvers_active_owner_idx
  ON openvtc_approvers (tenant_id, subject_id, enrolled_at DESC)
  WHERE status='active';

ALTER TABLE openvtc_consent_tasks
  DROP CONSTRAINT IF EXISTS openvtc_consent_tasks_operation_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS openvtc_consent_tasks_operation_approver_idx
  ON openvtc_consent_tasks (operation_id, approver_id);

CREATE TABLE IF NOT EXISTS openvtc_companion_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  approver_id uuid NOT NULL UNIQUE REFERENCES openvtc_approvers(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  protocol_version text NOT NULL CHECK (protocol_version = 'onecomputer-companion-push-0.1'),
  browser_family text NOT NULL CHECK (browser_family IN ('chrome','edge','firefox','safari','other')),
  platform text NOT NULL CHECK (platform IN ('windows','macos','linux','android','ios','other')),
  endpoint_hash text NOT NULL UNIQUE CHECK (length(endpoint_hash) = 64),
  subscription_ciphertext text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','invalid','revoked')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_successful_delivery_at timestamptz,
  last_failure_code text,
  UNIQUE (tenant_id, subject_id, installation_id)
);

CREATE INDEX IF NOT EXISTS openvtc_companion_subscriptions_owner_idx
  ON openvtc_companion_subscriptions (tenant_id, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS openvtc_companion_push_deliveries (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES openvtc_consent_tasks(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES openvtc_companion_subscriptions(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('queued','delivered','retry','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  delivered_at timestamptz,
  last_failure_code text,
  UNIQUE (task_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS openvtc_companion_push_deliveries_ready_idx
  ON openvtc_companion_push_deliveries (available_at, created_at)
  WHERE state IN ('queued','retry');
