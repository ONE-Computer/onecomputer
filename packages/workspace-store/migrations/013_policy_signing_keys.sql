CREATE TABLE IF NOT EXISTS policy_signing_keys (
  key_id text PRIMARY KEY,
  algorithm text NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key_spki_base64 text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','retiring','revoked')),
  activated_at timestamptz NOT NULL,
  expires_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_signing_keys_status_idx
  ON policy_signing_keys (status, activated_at DESC);
