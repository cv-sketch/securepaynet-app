-- supabase/migrations/20260428_passkeys_and_challenges.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE user_passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] DEFAULT '{}',
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_user_passkeys_user ON user_passkeys(user_id);

ALTER TABLE user_passkeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own passkeys (no key)" ON user_passkeys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user deletes own passkeys" ON user_passkeys
  FOR DELETE USING (auth.uid() = user_id);

REVOKE ALL ON user_passkeys FROM anon, authenticated;
GRANT SELECT (id, user_id, credential_id, transports, device_name, created_at, last_used_at)
  ON user_passkeys TO authenticated;
GRANT DELETE ON user_passkeys TO authenticated;

CREATE TABLE webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('register', 'auth')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

CREATE INDEX idx_webauthn_challenges_user_type ON webauthn_challenges(user_id, type);

ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON webauthn_challenges FROM anon, authenticated;

CREATE TABLE gate_password_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gate_password_attempts_user_created
  ON gate_password_attempts(user_id, created_at DESC);

ALTER TABLE gate_password_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gate_password_attempts FROM anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'webauthn_challenges_cleanup',
  '0 * * * *',
  $$DELETE FROM webauthn_challenges WHERE expires_at < NOW()$$
);

SELECT cron.schedule(
  'gate_password_attempts_cleanup',
  '*/10 * * * *',
  $$DELETE FROM gate_password_attempts WHERE created_at < NOW() - INTERVAL '10 minutes'$$
);
