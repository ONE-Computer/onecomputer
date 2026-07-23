ALTER TABLE sandbox_settings
  ADD COLUMN IF NOT EXISTS agent_ids jsonb NOT NULL DEFAULT '["claude-desktop","hermes-claw"]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sandbox_settings_agent_ids_array'
  ) THEN
    ALTER TABLE sandbox_settings
      ADD CONSTRAINT sandbox_settings_agent_ids_array
      CHECK (jsonb_typeof(agent_ids) = 'array' AND jsonb_array_length(agent_ids) BETWEEN 1 AND 2);
  END IF;
END $$;
