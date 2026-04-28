-- 20260428_user_security_and_pin.sql
-- Sprint 2 — PIN auth + elevation gate
-- Tables: user_security (PIN hash + lockout state), pin_security_audit_log (event trail)
-- RLS lockdown: only service_role via Edge Functions reads/writes these.

CREATE TABLE IF NOT EXISTS user_security (
  auth_user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash          TEXT,
  pin_set_at        TIMESTAMPTZ,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  total_lockouts    INTEGER NOT NULL DEFAULT 0,
  account_locked    BOOLEAN NOT NULL DEFAULT false,
  last_recovery_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_security_locked_until
  ON user_security(locked_until)
  WHERE locked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS pin_security_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event         TEXT NOT NULL CHECK (event IN (
                  'set', 'verify_ok', 'verify_fail',
                  'lockout', 'account_lockout',
                  'recovery_requested', 'recovery_completed',
                  'change'
                )),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pin_audit_user_time
  ON pin_security_audit_log(auth_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION user_security_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_security_updated_at ON user_security;
CREATE TRIGGER trg_user_security_updated_at
  BEFORE UPDATE ON user_security
  FOR EACH ROW EXECUTE FUNCTION user_security_set_updated_at();

ALTER TABLE user_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_security_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE user_security IS 'PIN hash and lockout state. service_role only via Edge Functions.';
COMMENT ON TABLE pin_security_audit_log IS 'Append-only audit trail for PIN events. service_role only.';
