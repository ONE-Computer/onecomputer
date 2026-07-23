CREATE TABLE IF NOT EXISTS egress_security_groups (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS egress_security_group_versions (
  id text PRIMARY KEY,
  security_group_id text NOT NULL REFERENCES egress_security_groups(id),
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (security_group_id, version),
  UNIQUE (security_group_id, document_hash)
);

ALTER TABLE policy_assignments
  ADD COLUMN IF NOT EXISTS egress_security_group_version_id text
  REFERENCES egress_security_group_versions(id);

CREATE OR REPLACE FUNCTION reject_egress_security_group_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'egress security group versions are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS egress_security_group_versions_immutable_update ON egress_security_group_versions;
CREATE TRIGGER egress_security_group_versions_immutable_update
BEFORE UPDATE OR DELETE ON egress_security_group_versions
FOR EACH ROW EXECUTE FUNCTION reject_egress_security_group_version_mutation();
