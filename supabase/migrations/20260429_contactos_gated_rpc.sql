-- supabase/migrations/20260429_contactos_gated_rpc.sql
-- Plan 3 Task 2: RPCs gated por gate_token (HMAC) + helper verify_gate_token

-- El secreto HMAC se guarda en vault.secrets con nombre 'GATE_TOKEN_SECRET'.
-- Sincronizado con el env var GATE_TOKEN_SECRET de Edge Functions (mismo valor).

CREATE OR REPLACE FUNCTION verify_gate_token(token TEXT, expected_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  parts TEXT[];
  payload_b64 TEXT;
  signature_b64 TEXT;
  payload_json JSONB;
  expected_hmac_b64 TEXT;
  secret TEXT;
  pad_len INT;
BEGIN
  parts := string_to_array(token, '.');
  IF parts IS NULL OR array_length(parts, 1) <> 2 THEN RETURN FALSE; END IF;

  payload_b64 := parts[1];
  signature_b64 := parts[2];

  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = 'GATE_TOKEN_SECRET'
  LIMIT 1;

  IF secret IS NULL OR secret = '' THEN RETURN FALSE; END IF;

  expected_hmac_b64 := encode(
    extensions.hmac(payload_b64::bytea, secret::bytea, 'sha256'),
    'base64'
  );
  -- Convertir a base64url y quitar padding
  expected_hmac_b64 := replace(replace(replace(expected_hmac_b64, '+', '-'), '/', '_'), '=', '');
  IF expected_hmac_b64 <> signature_b64 THEN RETURN FALSE; END IF;

  -- Decodificar payload (agregar padding si hace falta)
  pad_len := (4 - (length(payload_b64) % 4)) % 4;
  payload_json := convert_from(
    decode(replace(replace(payload_b64, '-', '+'), '_', '/') || repeat('=', pad_len), 'base64'),
    'utf8'
  )::jsonb;

  IF (payload_json->>'user_id')::UUID <> expected_user THEN RETURN FALSE; END IF;
  IF (payload_json->>'exp_unix')::BIGINT < extract(epoch from NOW())::BIGINT THEN RETURN FALSE; END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION verify_gate_token(TEXT, UUID) FROM PUBLIC, anon, authenticated;
-- No GRANT a authenticated: solo se invoca desde funciones SECURITY DEFINER.

CREATE OR REPLACE FUNCTION contactos_create_gated(input JSONB, gate_token TEXT)
RETURNS contactos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_caller UUID;
  cliente_id_target UUID;
  mi_cvu TEXT;
  cvu_input TEXT;
  result contactos;
BEGIN
  user_id_caller := auth.uid();
  IF user_id_caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF NOT verify_gate_token(gate_token, user_id_caller) THEN
    RAISE EXCEPTION 'gate_token invalido o expirado';
  END IF;

  SELECT id INTO cliente_id_target FROM clientes WHERE auth_user_id = user_id_caller;
  IF cliente_id_target IS NULL THEN RAISE EXCEPTION 'cliente no encontrado'; END IF;

  cvu_input := input->>'cvu';

  -- Auto-agendar bloqueado
  SELECT cvu INTO mi_cvu FROM wallets WHERE cliente_id = cliente_id_target;
  IF mi_cvu IS NOT NULL AND cvu_input = mi_cvu THEN
    RAISE EXCEPTION 'No podes agendarte a vos mismo';
  END IF;

  INSERT INTO contactos (
    cliente_id, nombre, cvu, alias, cuit, titular, banco,
    email, telefono, favorito, notas, entidad
  ) VALUES (
    cliente_id_target,
    input->>'nombre',
    cvu_input,
    input->>'alias',
    input->>'cuit',
    input->>'titular',
    input->>'banco',
    input->>'email',
    input->>'telefono',
    COALESCE((input->>'favorito')::BOOLEAN, FALSE),
    input->>'notas',
    input->>'entidad'
  ) RETURNING * INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION contactos_remove_gated(contacto_id UUID, gate_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_caller UUID;
BEGIN
  user_id_caller := auth.uid();
  IF user_id_caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT verify_gate_token(gate_token, user_id_caller) THEN
    RAISE EXCEPTION 'gate_token invalido o expirado';
  END IF;

  DELETE FROM contactos
  WHERE id = contacto_id
    AND cliente_id IN (SELECT id FROM clientes WHERE auth_user_id = user_id_caller);
END;
$$;

GRANT EXECUTE ON FUNCTION contactos_create_gated(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION contactos_remove_gated(UUID, TEXT) TO authenticated;
