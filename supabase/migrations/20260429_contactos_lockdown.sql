-- supabase/migrations/20260429_contactos_lockdown.sql
-- Plan 3 Task 7: lockdown final - forzar uso de RPCs gated.
--
-- IMPORTANTE: aplicar UNICAMENTE despues de que el front (PR) este
-- deployed en produccion y todos los flujos esten funcionando.
-- Aplicar antes rompe el alta/baja de contactos para usuarios logueados.

REVOKE INSERT, DELETE ON contactos FROM authenticated;
-- UPDATE queda permitido por RLS (los campos identitarios son inmutables desde la UI).
-- SELECT queda permitido por RLS.
