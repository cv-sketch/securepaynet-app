-- supabase/migrations/20260428_onboarding_constraints.sql
-- Asegura idempotencia del onboarding-complete:
-- el ON CONFLICT DO NOTHING en clientes(auth_user_id) requiere UNIQUE.

ALTER TABLE clientes
  ADD CONSTRAINT clientes_auth_user_id_unique UNIQUE (auth_user_id);
