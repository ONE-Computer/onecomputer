DROP INDEX IF EXISTS openvtc_approvers_active_owner_idx;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id,subject_id ORDER BY enrolled_at DESC,id DESC) AS position
  FROM openvtc_approvers
  WHERE status='active'
)
UPDATE openvtc_approvers AS approver
SET status='revoked',revoked_at=COALESCE(approver.revoked_at,now())
FROM ranked
WHERE approver.id=ranked.id AND ranked.position>1;

CREATE UNIQUE INDEX openvtc_approvers_active_owner_idx
  ON openvtc_approvers (tenant_id, subject_id)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS openvtc_enrollment_challenges (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  executor_did text NOT NULL,
  challenge text NOT NULL UNIQUE CHECK (length(challenge) >= 16),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS openvtc_enrollment_challenges_owner_idx
  ON openvtc_enrollment_challenges (tenant_id, subject_id, created_at DESC);
