CREATE TABLE IF NOT EXISTS sandbox_settings (
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  grant_id text NOT NULL,
  profile_id text NOT NULL CHECK (profile_id IN ('claude-desktop-standard-v1','kasm-persistent-standard')),
  model_alias text NOT NULL CHECK (model_alias IN ('onecomputer-claude','onecomputer-openai','onecomputer-glm','onecomputer-assistant')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id, grant_id)
);
