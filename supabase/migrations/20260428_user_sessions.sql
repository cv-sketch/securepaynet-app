-- supabase/migrations/20260428_user_sessions.sql
-- Sprint 1 — sesiones server-side con idle/absolute timeout y audit log.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  idle_timeout_seconds integer NOT NULL,
  role text NOT NULL DEFAULT 'standard',
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('user', 'idle', 'absolute', 'forced_admin', 'password_changed') OR revoke_reason IS NULL),
  ip text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_active_idx
  ON public.user_sessions(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_sessions_absolute_expires_idx
  ON public.user_sessions(absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.session_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('created', 'heartbeat', 'expired_idle', 'expired_absolute', 'user_logout', 'forced_admin', 'password_changed')),
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_audit_log_user_idx
  ON public.session_audit_log(user_id, created_at DESC);

-- RLS: clientes nunca leen ni escriben directo. Sólo service_role (Edge Functions).
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_audit_log ENABLE ROW LEVEL SECURITY;

-- Sin policies para 'authenticated' → RLS niega todo por default.
