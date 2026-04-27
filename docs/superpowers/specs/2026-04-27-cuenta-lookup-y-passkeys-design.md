# Spec: Cuenta lookup + Passkeys + Agenda obligatoria

**Fecha:** 2026-04-27
**Autor:** brainstorming session (cv@ibba.group)
**Estado:** Diseño aprobado, pendiente de implementación

---

## 1. Motivación y alcance

Hoy en `securepaynet-app` el usuario puede transferir tipeando CBU/CVU + CUIT a mano. Esto:
1. No valida que el destinatario sea real antes del INSERT.
2. Permite errores de tipeo del CUIT que se descubren recién en el upstream.
3. No diferencia destinatarios habituales de uno-shot.

Este spec introduce:

1. **Lookup de cuenta** mockeado vía `bdc-proxy` (endpoint `account.lookup`) que en `BDC_MODE=mock` simula la respuesta de COELSA: dado un CBU/CVU o un alias, devuelve `nombre`, `cuit`, `cvu_completo` y `entidad` (banco/billetera).
2. **Agenda obligatoria para transferir.** Después de este cambio, **no se puede transferir a una cuenta que no esté previamente agendada como contacto**. La agenda es la frontera de validación.
3. **Gate de seguridad para alta/baja de contactos.** Agendar o eliminar un contacto requiere passkey (WebAuthn) o, como fallback, password de la cuenta. Esto protege contra teléfonos/laptops perdidos: aunque alguien tenga la sesión activa, no puede agregar nuevos destinatarios sin el segundo factor.

**Fuera de alcance de este PR:**
- Implementación del modo `live` real contra la API del banco upstream (queda como stub).
- Botón "Guardar como contacto" en el modal de comprobante (redundante: ya no se puede transferir a alguien no agendado).
- Soporte de passkeys en preview branches de Vercel (cae a password automáticamente porque el RP ID no matchea).

---

## 2. Arquitectura general

```
[Contactos.tsx — alta]
    │ 1. Buscar (CBU/CVU o Alias)
    ▼
[bdc-proxy: account.lookup] ── mock: tabla entidades + generador determinístico
    │ 2. {nombre, cuit, cvu_completo, entidad}
    ▼
[Card de confirmación] (read-only)
    │ 3. Confirmar y guardar
    ▼
[<SecurityGate>] ── intenta passkey → si no, password Supabase
    │ 4. onSuccess(gate_token)
    ▼
[RPC contactos_create_gated] ── verifica HMAC del gate_token, INSERT

[Transferir.tsx]
    │ Picker de agenda (obligatorio) + monto/concepto/desc
    ▼
[transferencia-execute] (sin cambios)
```

---

## 3. Modelo de datos

### 3.1 Migración `20260427_contactos_entidad.sql`

```sql
ALTER TABLE contactos ADD COLUMN entidad TEXT;

ALTER TABLE contactos
  ADD CONSTRAINT contactos_cliente_cvu_unique UNIQUE (cliente_id, cvu);

-- Backfill best-effort para los contactos ya existentes:
-- aplica el mismo lookup de prefijos que el helper de Edge Functions.
UPDATE contactos
SET entidad = CASE
  WHEN cvu LIKE '0000003%' THEN 'Mercado Pago'
  WHEN cvu LIKE '0000019%' THEN 'Personal Pay'
  WHEN cvu LIKE '0000044%' THEN 'Naranja X'
  WHEN cvu LIKE '0000054%' THEN 'Ualá'
  WHEN cvu LIKE '0000086%' THEN 'Lemon'
  WHEN cvu LIKE '0000094%' THEN 'Belo'
  WHEN substring(cvu, 1, 3) IN ('005','007') THEN 'Banco Galicia'
  WHEN substring(cvu, 1, 3) = '011' THEN 'Banco Nación'
  WHEN substring(cvu, 1, 3) = '014' THEN 'Banco Provincia'
  WHEN substring(cvu, 1, 3) = '015' THEN 'ICBC'
  WHEN substring(cvu, 1, 3) = '017' THEN 'BBVA'
  WHEN substring(cvu, 1, 3) = '027' THEN 'Supervielle'
  WHEN substring(cvu, 1, 3) = '029' THEN 'Banco Ciudad'
  WHEN substring(cvu, 1, 3) = '034' THEN 'Banco Patagonia'
  WHEN substring(cvu, 1, 3) = '044' THEN 'Banco Hipotecario'
  WHEN substring(cvu, 1, 3) = '072' THEN 'Santander'
  WHEN substring(cvu, 1, 3) = '143' THEN 'Brubank'
  WHEN substring(cvu, 1, 3) = '150' THEN 'HSBC'
  WHEN substring(cvu, 1, 3) = '191' THEN 'Credicoop'
  WHEN substring(cvu, 1, 3) = '259' THEN 'Itaú'
  WHEN substring(cvu, 1, 3) = '285' THEN 'Macro'
  WHEN substring(cvu, 1, 3) = '299' THEN 'Comafi'
  WHEN substring(cvu, 1, 3) = '384' THEN 'Wilobank'
  WHEN substring(cvu, 1, 3) = '389' THEN 'Banco de Comercio'
  ELSE 'Otra entidad'
END
WHERE entidad IS NULL AND cvu IS NOT NULL;
```

### 3.2 Migración `20260427_passkeys_and_challenges.sql`

```sql
-- Requerido para hmac() usado en verify_gate_token (sección 3.3).
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
-- INSERT/UPDATE: solo service_role. public_key nunca sale al cliente.

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
-- Solo service_role. Cero policies para auth users.

-- Para rate-limit de intentos de password en el gate (sección 4.3 → gate-password).
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
-- Solo service_role.
```

### 3.3 Migración `20260427_contactos_gated_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION contactos_create_gated(
  input JSONB,
  gate_token TEXT
) RETURNS contactos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_caller UUID;
  cliente_id_target UUID;
  result contactos;
BEGIN
  user_id_caller := auth.uid();
  IF user_id_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Verificar HMAC del gate_token (clave en config 'app.gate_token_secret')
  -- Formato: base64url(payload).base64url(hmac)
  -- Payload contiene: {user_id, exp_unix}
  IF NOT verify_gate_token(gate_token, user_id_caller) THEN
    RAISE EXCEPTION 'gate_token invalido o expirado';
  END IF;

  -- Resolver cliente_id desde auth.uid()
  SELECT id INTO cliente_id_target
  FROM clientes WHERE auth_user_id = user_id_caller;

  IF cliente_id_target IS NULL THEN
    RAISE EXCEPTION 'cliente no encontrado';
  END IF;

  INSERT INTO contactos (
    cliente_id, nombre, cvu, alias, cuit, titular, banco,
    email, telefono, favorito, notas, entidad
  ) VALUES (
    cliente_id_target,
    input->>'nombre',
    input->>'cvu',
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

CREATE OR REPLACE FUNCTION contactos_remove_gated(
  contacto_id UUID,
  gate_token TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_caller UUID;
BEGIN
  user_id_caller := auth.uid();
  IF user_id_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT verify_gate_token(gate_token, user_id_caller) THEN
    RAISE EXCEPTION 'gate_token invalido o expirado';
  END IF;

  DELETE FROM contactos
  WHERE id = contacto_id
    AND cliente_id IN (SELECT id FROM clientes WHERE auth_user_id = user_id_caller);
END;
$$;

-- Helper de verificación HMAC. Lee secreto de current_setting.
CREATE OR REPLACE FUNCTION verify_gate_token(token TEXT, expected_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  parts TEXT[];
  payload_b64 TEXT;
  signature_b64 TEXT;
  payload_json JSONB;
  expected_hmac TEXT;
  secret TEXT;
BEGIN
  parts := string_to_array(token, '.');
  IF array_length(parts, 1) <> 2 THEN RETURN FALSE; END IF;

  payload_b64 := parts[1];
  signature_b64 := parts[2];

  secret := current_setting('app.gate_token_secret', true);
  IF secret IS NULL OR secret = '' THEN RETURN FALSE; END IF;

  expected_hmac := encode(
    hmac(payload_b64::bytea, secret::bytea, 'sha256'),
    'base64'
  );
  -- Comparar quitando padding
  expected_hmac := replace(replace(replace(expected_hmac, '+', '-'), '/', '_'), '=', '');
  IF expected_hmac <> signature_b64 THEN RETURN FALSE; END IF;

  payload_json := convert_from(decode(payload_b64 || repeat('=', 4 - (length(payload_b64) % 4)), 'base64'), 'utf8')::jsonb;

  IF (payload_json->>'user_id')::UUID <> expected_user THEN RETURN FALSE; END IF;
  IF (payload_json->>'exp_unix')::BIGINT < extract(epoch from NOW())::BIGINT THEN RETURN FALSE; END IF;

  RETURN TRUE;
END;
$$;

-- Después de crear las RPC, revocar INSERT/DELETE directo:
REVOKE INSERT, DELETE ON contactos FROM authenticated;
GRANT EXECUTE ON FUNCTION contactos_create_gated(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION contactos_remove_gated(UUID, TEXT) TO authenticated;
```

**Nota sobre `app.gate_token_secret`:** se setea vía Management API con
`ALTER DATABASE postgres SET app.gate_token_secret = '<secret>'` o equivalente. El mismo secreto va como env var `GATE_TOKEN_SECRET` en las Edge Functions que lo emiten.

---

## 4. Edge Functions

### 4.1 `bdc-proxy` (extensión)

Nuevo endpoint `account.lookup`:

```ts
// Request
{ endpoint: 'account.lookup', payload: { type: 'cbu' | 'alias', value: string } }

// Response OK
{ ok: true, data: { nombre: string, cuit: string, cvu_completo: string, entidad: string } }

// Response ERR
{ ok: false, code: 'INVALID_FORMAT' | 'NOT_FOUND' | 'ACCOUNT_DISABLED' | 'UPSTREAM_ERROR', message: string }
```

**Mock branch (`BDC_MODE=mock`):**
1. Validación de formato:
   - `cbu`: `/^\d{22}$/`
   - `alias`: `/^[a-zA-Z0-9](?:[a-zA-Z0-9.\-]{4,18})[a-zA-Z0-9]$/` (6-20 chars, no inicia/termina con punto o guion).
2. Genera datos determinísticos a partir del input (SHA-256 del value, consume bytes para indexar arrays):
   - `cvu_completo`: si fue CBU, el mismo. Si fue alias, prefijo de entidad random + 15 dígitos derivados del hash.
   - `nombre`: pool de ~30 nombres argentinos.
   - `cuit`: `20`/`27` + 8 dígitos del hash + dígito verificador BCRA real.
   - `entidad`: lookup en `_shared/entidades.ts` por prefijo del CVU.
3. **Caso simulado de cuenta inhabilitada:** si los últimos 4 dígitos del CVU son `0000` → devuelve `ACCOUNT_DISABLED`.

**Live branch:** stub `throw new Error('live mode no implementado')`.

### 4.2 Helper `_shared/entidades.ts`

```ts
const ENTIDADES_CBU: Record<string, string> = {
  '005': 'Banco Galicia', '007': 'Banco Galicia', '011': 'Banco Nación',
  '014': 'Banco Provincia', '015': 'ICBC', '017': 'BBVA',
  '027': 'Supervielle', '029': 'Banco Ciudad', '034': 'Banco Patagonia',
  '044': 'Banco Hipotecario', '072': 'Santander', '143': 'Brubank',
  '150': 'HSBC', '191': 'Credicoop', '259': 'Itaú',
  '285': 'Macro', '299': 'Comafi', '384': 'Wilobank',
  '389': 'Banco de Comercio',
}

const ENTIDADES_CVU: Record<string, string> = {
  '0000003': 'Mercado Pago', '0000019': 'Personal Pay',
  '0000044': 'Naranja X', '0000054': 'Ualá',
  '0000086': 'Lemon', '0000094': 'Belo',
}

export function entidadByPrefix(cvu: string): string {
  if (cvu.startsWith('0000')) {
    const cvuPrefix = cvu.substring(0, 7)
    if (ENTIDADES_CVU[cvuPrefix]) return ENTIDADES_CVU[cvuPrefix]
  }
  const cbuPrefix = cvu.substring(0, 3)
  return ENTIDADES_CBU[cbuPrefix] ?? 'Otra entidad'
}
```

### 4.3 Edge Functions de passkeys

| Función | Propósito |
|---|---|
| `passkey-register-begin` | Genera challenge de registro, INSERT en `webauthn_challenges`, devuelve `PublicKeyCredentialCreationOptions` |
| `passkey-register-finish` | Body: `{credential, deviceName?}`. Verifica con `@simplewebauthn/server`. INSERT en `user_passkeys` |
| `passkey-auth-begin` | Genera challenge de auth con `allowCredentials` del usuario. Si no tiene passkeys → `{ok:false, code:'NO_PASSKEYS'}` |
| `passkey-auth-finish` | Verifica assertion. UPDATE counter (rechaza si counter ≤ guardado). Emite `gate_token` HMAC con expiración 60s |
| `gate-password` | Recibe `{password}`. Verifica con un cliente Supabase **separado** (`createClient` con anon key, sin persistencia, sin afectar la sesión del usuario actual): `tempClient.auth.signInWithPassword({email, password})`. Si OK, emite `gate_token`. **Importante:** no usa el cliente con `service_role` ni el cliente del usuario, para no rotar la sesión activa del browser. Rate-limit: 5 intentos / 10 min por user_id (tabla `gate_password_attempts` con TTL) |

**Formato de `gate_token`:**
```
base64url(JSON.stringify({user_id, exp_unix})).base64url(HMAC-SHA256(payload, secret))
```
Cualquier Edge Function que tenga `GATE_TOKEN_SECRET` puede emitirlo. El RPC PostgreSQL lo verifica con la misma clave (vía `app.gate_token_secret`).

### 4.4 Cron de limpieza

Vía `pg_cron` (extensión disponible en Supabase). Se schedulea desde la migración:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'webauthn_challenges_cleanup',
  '0 * * * *',
  $$DELETE FROM webauthn_challenges WHERE expires_at < NOW()$$
);

-- Idem para gate_password_attempts (TTL 10 min):
SELECT cron.schedule(
  'gate_password_attempts_cleanup',
  '*/10 * * * *',
  $$DELETE FROM gate_password_attempts WHERE created_at < NOW() - INTERVAL '10 minutes'$$
);
```

**Nota:** si `pg_cron` no estuviera habilitado en el proyecto Supabase, alternativa es un trigger `BEFORE INSERT` en cada tabla que borra entries expiradas del mismo `user_id`. Menos eficiente pero no requiere extensión.

---

## 5. Componentes y UX

### 5.1 `<SecurityGate>` (`src/components/SecurityGate.tsx`)

```ts
type Props = {
  open: boolean
  reason: string                              // "agendar contacto", etc.
  onClose: () => void
  onSuccess: (gateToken: string) => void
}
```

**Flujo interno:**
1. Al abrir → llama `passkey-auth-begin`.
2. Si `NO_PASSKEYS` o WebAuthn no soportado → modo password directo.
3. Si options OK → `navigator.credentials.get()`. Si éxito → `passkey-auth-finish` → `onSuccess(gate_token)`.
4. Si el usuario cancela el prompt biométrico o falla → muestra botón "Usar contraseña" → modo password.
5. Modo password: input + botón "Confirmar" → `gate-password` Edge Function → `onSuccess(gate_token)`.

**Estados UI:** `idle` | `pending-passkey` | `mode-password` | `pending-password` | `error`.

### 5.2 `Contactos.tsx` (refactor)

**Alta:** modal de 3 steps:
1. **Buscar:** tabs `CBU/CVU` | `Alias`, input, botón "Buscar destinatario".
2. **Confirmar:** card read-only con avatar, nombre, CUIT, CVU completo, entidad. Inputs editables: `apodo` (sobreescribe `nombre`), toggle favorito. Botones "Atrás" / "Confirmar y guardar".
3. **Gate:** `<SecurityGate>` abierto. `onSuccess` → `contactosService.createGated(input, gateToken)` → cierra modal, refresca lista, toast.

**Edición de contactos existentes:**
- Editable: `nombre` (apodo), `alias`, `favorito`, `notas`.
- Read-only: `cvu`, `cuit`, `titular`, `entidad` (la identidad del destinatario es inmutable; para cambiar, borrá y agendá de nuevo).

**Eliminar:**
- Confirma con `<SecurityGate reason="eliminar contacto" />`.
- `onSuccess` → `contactosService.removeGated(id, gateToken)`.

### 5.3 `Transferir.tsx` (refactor)

**Sacar:**
- Inputs CBU/CVU y CUIT del destinatario.
- Validación inline de esos campos en `handleSubmit`.

**Render nuevo:**
```
[Saldo disponible]

[Sección "Destinatario"]
  Si !contactoSel:
    Botón grande "Elegir contacto de la agenda" (obligatorio)
    Texto: "Solo podés transferir a contactos previamente agendados.
            ¿No está en tu agenda? Agregalo desde Contactos."
  Si contactoSel:
    Card con avatar + nombre + alias/CVU enmascarado + entidad + CUIT
    Botón "Cambiar"

[Sección "Detalles" — solo si contactoSel]
  Monto / Concepto / Descripción

[Botón "Enviar transferencia"] (disabled si !contactoSel)
```

**`handleSubmit`:** abort si `!contactoSel`. Manda al `transferencia-execute` los datos del contacto.

**URL param `?contactoId`:** se mantiene como hoy.

**Empty state si no hay contactos:** mensaje + CTA "Agregá tu primer contacto" → `/contactos`.

### 5.4 Gestión de passkeys en `Perfil.tsx`

Nueva sección "Seguridad → Dispositivos confiables (Passkeys)":
- Lista de passkeys con `device_name`, `created_at`, `last_used_at`, botón "Eliminar".
- Botón "+ Registrar este dispositivo" → `passkey-register-begin` → `navigator.credentials.create()` → `passkey-register-finish` con `deviceName` autodetectado del UA.
- Estado vacío: "No tenés passkeys registradas. Te vamos a pedir contraseña en cada operación sensible."
- Si WebAuthn no soportado: "Tu navegador no soporta passkeys."

**Onboarding suave:** la primera vez que el `<SecurityGate>` resuelve por password sin passkey registrada → toast "¿Querés evitar tener que escribir la contraseña? Registrá una passkey en Perfil → Seguridad."

### 5.5 Services

**`src/services/contactosService.ts`:**
- `create(...)` → renombrar a `createGated(input, gateToken)`. Llama RPC `contactos_create_gated`.
- `remove(...)` → renombrar a `removeGated(id, gateToken)`. Llama RPC `contactos_remove_gated`.
- `update(...)` queda igual (RLS de UPDATE permite por user_id; los campos identitarios son inmutables desde la UI).

**Nuevo `src/services/passkeyService.ts`:**
```ts
export const passkeyService = {
  list(): Promise<Passkey[]>
  registerCurrentDevice(deviceName?: string): Promise<void>
  remove(id: string): Promise<void>
  authenticate(): Promise<{ gateToken: string }>
  authenticateWithPassword(password: string): Promise<{ gateToken: string }>
  isWebAuthnSupported(): boolean
}
```

**Nuevo `src/services/lookupService.ts`:**
```ts
export const lookupService = {
  lookup(type: 'cbu' | 'alias', value: string): Promise<{
    nombre: string
    cuit: string
    cvu_completo: string
    entidad: string
  }>
}
```

---

## 6. Manejo de errores

| Escenario | Comportamiento |
|---|---|
| Lookup: formato inválido | Inline error bajo el campo. Botón "Buscar" disabled hasta corregir |
| Lookup: alias / CBU no encontrado | Card de error: "No encontramos esa cuenta." Permite reintentar |
| Lookup: timeout / 5xx upstream | Toast: "El servicio no responde. Intentá de nuevo." |
| Lookup: cuenta inhabilitada (mock: CVU termina en `0000`) | "Esta cuenta no está disponible para recibir transferencias." Bloqueo |
| Gate: passkey cancelada | Botón "Usar contraseña" (no es error fatal) |
| Gate: password incorrecta | Inline error. **5 intentos fallidos en 10 min → bloqueo de gate por 15 min** |
| Gate: counter clonado (`CLONED_CREDENTIAL`) | Modal serio: "Detectamos un problema de seguridad con esta passkey. Eliminala desde Perfil." Loggea event |
| RPC: gate_token expirado | Cierra modal, mensaje "La verificación expiró. Intentá de nuevo." |
| Transferir: sin contactos en agenda | Empty state con CTA → `/contactos` |
| Passkey register: WebAuthn no soportado | Sección Perfil muestra mensaje informativo |
| Contacto duplicado por CVU | Error de constraint UNIQUE → "Ya tenés ese contacto agendado" |
| Auto-agendarse | RPC valida `cvu_completo != mi_propio_cvu` → "No podés agendarte a vos mismo" |

---

## 7. Edge cases

- **Mismo dispositivo, dos cuentas Supabase:** cada `user_passkeys` row es por `user_id`. No hay conflict.
- **Pérdida del único passkey:** la password de cuenta sigue siendo válida. No hay lockout.
- **Pérdida de password Y passkeys:** flujo standard de Supabase password reset por email.
- **Race condition en counter:** UPDATE usa `WHERE counter < $newCounter`. Si 0 filas → reject.
- **Limpieza de challenges:** cron horario.

---

## 8. Testing

**Unitarios (Vitest):**
- `entidadByPrefix` para cada código + caso `'Otra entidad'`.
- Generador determinístico mock: mismo input → mismo `cuit/cvu_completo/nombre`.
- Validación de formato CBU/alias.

**Edge Functions (Deno test):**
- `bdc-proxy` `account.lookup`: input válido → shape correcto. Inválido → `INVALID_FORMAT`. CVU `...0000` → `ACCOUNT_DISABLED`.
- `passkey-register-finish`: challenge expirado → 401. Mismatch → 401. OK → INSERT.
- `passkey-auth-finish`: counter clonado → reject. Normal → emite `gate_token`.
- `gate_token` HMAC: tampering → reject.
- `verify_gate_token` PG: expirado, mismatch user, secreto vacío → todos retornan false.

**Manual checklist en el PR:**
- Alta de contacto E2E con passkey (Touch ID + Face ID).
- Alta con password fallback (passkey cancelada).
- Transferencia a contacto existente.
- Sin contactos → empty state.
- Eliminar passkey → siguiente operación pide password.
- Mock determinístico: alias `juan.perez` → siempre mismo CUIT/nombre.
- Edición de contacto: campos identitarios efectivamente read-only.
- Auto-agendarse → bloqueado.

---

## 9. Configuración y rollout

### Env vars nuevas (Edge Functions)

| Variable | Para qué |
|---|---|
| `WEBAUTHN_RP_ID` | `securepaynet-wallet.vercel.app` |
| `WEBAUTHN_RP_NAME` | `SecurePayNet` |
| `WEBAUTHN_ORIGIN` | `https://securepaynet-wallet.vercel.app` |
| `GATE_TOKEN_SECRET` | HMAC key del gate_token (sincroniza con `app.gate_token_secret` en Postgres) |
| `BDC_MODE` | Existente. `mock` por defecto |

### Orden de aplicación

1. Aplicar las 3 migraciones SQL en orden vía Management API:
   - `20260427_contactos_entidad.sql`
   - `20260427_passkeys_and_challenges.sql`
   - `20260427_contactos_gated_rpc.sql` (incluye REVOKE INSERT/DELETE)
2. Setear `app.gate_token_secret` en Postgres (mismo valor que `GATE_TOKEN_SECRET` en Edge Functions).
3. Deploy de Edge Functions: `bdc-proxy` (extendido), `passkey-*` (5 nuevas), `gate-password`, `passkey-cleanup-challenges`.
4. Deploy del front (Vercel auto-deploy del PR).

⚠️ **Crítico:** las migraciones, el secreto y las Edge Functions deben aplicarse antes del merge a main. Si se revoca INSERT/DELETE en `contactos` antes de tener la RPC + Edge Functions desplegadas, el front rompe en producción.

### Preview branches de Vercel

`WEBAUTHN_RP_ID` apunta a producción, así que en previews los passkeys no funcionan → cae automáticamente a password. Es comportamiento esperado, no es bug.

---

## 10. Decisiones tomadas durante el brainstorming

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Extender `bdc-proxy` con `account.lookup` | Edge Function nueva separada | Consistente con patrón actual; reusa auth/CORS |
| Tabs CBU/CVU \| Alias separados | Un solo campo que detecta el tipo | Pedido explícito del usuario |
| Lookup con botón "Buscar" explícito | Auto-debounce | Pedido explícito; reduce llamados accidentales |
| CUIT viene siempre del lookup, nunca tipeado | Input editable como override | El CUIT debe venir de COELSA, no del usuario |
| Lookup falla → bloqueo total | Permitir continuar manual | Sin validación, no hay transferencia |
| Agenda obligatoria para transferir | Permitir transferir directo + ofrecer agendar después | Pedido explícito del usuario |
| Passkey + password fallback | Solo password / PIN transaccional | Pedido explícito del usuario |
| Passkey real en este PR | Diferir a Fase 2 con stub | Pedido explícito del usuario |
| Componente `<SecurityGate>` único | Dos modales separados | Reutilizable y UX consistente |
| Tabla `user_passkeys` con RLS estricta | Solo policies relajadas | Pedido explícito: tabla muy protegida |
| RPC `contactos_create_gated` con HMAC | Confianza en el front | Sin esto, el SecurityGate sería teatro de UI |

---

## 11. Trabajo futuro (fuera de scope)

- Implementación real del modo `live` de `bdc-proxy account.lookup` contra el API del banco.
- Botón "Guardar como contacto" tras transferencia exitosa: descartado por la regla de agenda obligatoria.
- Gate de seguridad para otras operaciones (transferencias > N, cambio de password, baja de cuenta).
- Soporte para múltiples cuentas conectadas (hoy un cliente = una wallet).
- Recuperación de passkeys vía mecanismo aparte (hoy solo se reemplazan registrando otro).
