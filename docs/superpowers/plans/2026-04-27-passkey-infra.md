# Plan 2/3 — Passkey Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Infraestructura WebAuthn end-to-end: tablas con RLS estricta, 5 Edge Functions (4 passkey-* + gate-password), service en el front, sección "Passkeys" en Perfil. Sin enforcing del gate todavía — eso lo hace el Plan 3. Al finalizar este plan, un usuario puede registrar passkeys y autenticarse con ellas, pero ninguna operación las requiere aún.

**Architecture:** Tablas `user_passkeys`, `webauthn_challenges`, `gate_password_attempts` con RLS estricta (INSERT/UPDATE bloqueado a `authenticated`, sólo `service_role` vía Edge Functions). Edge Functions usan `@simplewebauthn/server` (vía `esm.sh` para Deno) y emiten un `gate_token` HMAC firmado con `GATE_TOKEN_SECRET`. Front usa `@simplewebauthn/browser`.

**Tech Stack:** Deno, `@simplewebauthn/server` (esm.sh), `@simplewebauthn/browser` (npm), Supabase RLS, pgcrypto, pg_cron.

**Spec de referencia:** `docs/superpowers/specs/2026-04-27-cuenta-lookup-y-passkeys-design.md` secciones 3.2, 4.3, 4.4, 5.1, 5.4.

**Depende de:** ninguno (este plan se puede hacer en paralelo con el Plan 1).

---

## File Structure

| Path | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260428_passkeys_and_challenges.sql` | Crear + aplicar | Tablas + RLS + pg_cron |
| `supabase/functions/_shared/gateToken.ts` | Crear | HMAC sign/verify del gate_token |
| `supabase/functions/_shared/gateToken_test.ts` | Crear | Tests sign/verify, tampering, expiración |
| `supabase/functions/_shared/cors.ts` | Crear (si no existe) | Helpers CORS reusables |
| `supabase/functions/passkey-register-begin/index.ts` | Crear | Genera options de registro |
| `supabase/functions/passkey-register-finish/index.ts` | Crear | Verifica + INSERT en user_passkeys |
| `supabase/functions/passkey-auth-begin/index.ts` | Crear | Genera options de auth |
| `supabase/functions/passkey-auth-finish/index.ts` | Crear | Verifica + emite gate_token |
| `supabase/functions/gate-password/index.ts` | Crear | Verifica password + emite gate_token |
| `package.json` | Modificar | Agregar `@simplewebauthn/browser` |
| `src/lib/webauthn.ts` | Crear | Helper de browser para `credentials.create/get` |
| `src/services/passkeyService.ts` | Crear | API del front |
| `src/pages/Perfil.tsx` | Modificar | Sección "Dispositivos confiables (Passkeys)" |

---

## Task 1: Migración SQL `passkeys_and_challenges`

**Files:**
- Crear: `supabase/migrations/20260428_passkeys_and_challenges.sql`
- Aplicar a Supabase prod via Management API

- [ ] **Step 1:** Crear branch
```bash
git checkout main && git pull
git checkout -b feat/passkey-infra
```

- [ ] **Step 2:** Crear el archivo de migración
```sql
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
```

- [ ] **Step 3:** Aplicar la migración usando Management API (mismo patrón que en Plan original de contactos)

```bash
# Asumiendo SUPABASE_MGMT_TOKEN exportado en env (revocarlo despues)
PROJECT_REF=lkqyzyvfcnfzihhlhuru
MIGRATION=$(cat supabase/migrations/20260428_passkeys_and_challenges.sql)

python3 -c "
import os, json, urllib.request
sql = '''$MIGRATION'''
data = json.dumps({'query': sql}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/$PROJECT_REF/database/query',
    data=data,
    headers={
        'Authorization': f'Bearer {os.environ[\"SUPABASE_MGMT_TOKEN\"]}',
        'Content-Type': 'application/json',
    },
    method='POST',
)
print(urllib.request.urlopen(req).read().decode())
"
```
Expected: HTTP 201 con resultado de cada statement.

⚠️ **Si pg_cron no está disponible** en tu plan Supabase, comentá los `cron.schedule` y dejá un TODO para implementar trigger-based cleanup.

- [ ] **Step 4:** Verificar las tablas
```bash
python3 -c "
import os, json, urllib.request
sql = \"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_passkeys','webauthn_challenges','gate_password_attempts') ORDER BY table_name\"
data = json.dumps({'query': sql}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/database/query',
    data=data,
    headers={'Authorization': f'Bearer {os.environ[\"SUPABASE_MGMT_TOKEN\"]}', 'Content-Type': 'application/json'},
    method='POST',
)
print(urllib.request.urlopen(req).read().decode())
"
```
Expected: 3 filas con los nombres de las tablas.

- [ ] **Step 5:** Setear `app.gate_token_secret` (generar 32 bytes random base64)
```bash
SECRET=$(openssl rand -base64 32)
echo "GATE_TOKEN_SECRET=$SECRET" >> /tmp/secrets-to-add.env

python3 -c "
import os, json, urllib.request
sql = f\"ALTER DATABASE postgres SET app.gate_token_secret = '${SECRET}'\"
data = json.dumps({'query': sql}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/database/query',
    data=data,
    headers={'Authorization': f'Bearer {os.environ[\"SUPABASE_MGMT_TOKEN\"]}', 'Content-Type': 'application/json'},
    method='POST',
)
print(urllib.request.urlopen(req).read().decode())
"
```
Expected: HTTP 201. Guardá el `$SECRET` para usarlo como Edge Function env var en Task 9.

- [ ] **Step 6:** Commit
```bash
git add supabase/migrations/20260428_passkeys_and_challenges.sql
git commit -m "feat(db): tablas user_passkeys, webauthn_challenges, gate_password_attempts con RLS estricta"
```

---

## Task 2: Helper `_shared/gateToken.ts` con tests

**Files:**
- Crear: `supabase/functions/_shared/gateToken.ts`
- Crear: `supabase/functions/_shared/gateToken_test.ts`

- [ ] **Step 1:** Tests primero
```ts
// supabase/functions/_shared/gateToken_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { signGateToken, verifyGateToken } from './gateToken.ts'

const SECRET = 'test-secret-32-bytes-min-aaaaaaaaaaaa'
const USER = '11111111-1111-1111-1111-111111111111'

Deno.test('signGateToken + verifyGateToken: round-trip OK', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  const ok = await verifyGateToken(token, USER, SECRET)
  assertEquals(ok, true)
})

Deno.test('verifyGateToken: tampered payload -> false', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  const [, sig] = token.split('.')
  const fakePayload = btoa(JSON.stringify({ user_id: USER, exp_unix: Date.now() / 1000 + 999999 }))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  const tampered = `${fakePayload}.${sig}`
  assertEquals(await verifyGateToken(tampered, USER, SECRET), false)
})

Deno.test('verifyGateToken: secreto incorrecto -> false', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  assertEquals(await verifyGateToken(token, USER, 'otro-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaa'), false)
})

Deno.test('verifyGateToken: user mismatch -> false', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  const otroUser = '22222222-2222-2222-2222-222222222222'
  assertEquals(await verifyGateToken(token, otroUser, SECRET), false)
})

Deno.test('verifyGateToken: token expirado -> false', async () => {
  const token = await signGateToken(USER, -10, SECRET) // ya expirado
  assertEquals(await verifyGateToken(token, USER, SECRET), false)
})
```

- [ ] **Step 2:** Verificar que fallan
```bash
deno test supabase/functions/_shared/gateToken_test.ts
```

- [ ] **Step 3:** Implementar
```ts
// supabase/functions/_shared/gateToken.ts

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i])
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4)
  const norm = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(pad)
  return atob(norm)
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signGateToken(userId: string, ttlSeconds: number, secret: string): Promise<string> {
  const payload = { user_id: userId, exp_unix: Math.floor(Date.now() / 1000) + ttlSeconds }
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  return `${payloadB64}.${b64urlEncode(sig)}`
}

export async function verifyGateToken(token: string, expectedUserId: string, secret: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sigB64] = parts

  const key = await importHmacKey(secret)
  const sigBytes = Uint8Array.from(b64urlDecodeToString(sigB64), (c) => c.charCodeAt(0))
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payloadB64))
  if (!valid) return false

  let payload: { user_id?: string; exp_unix?: number }
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64))
  } catch {
    return false
  }
  if (payload.user_id !== expectedUserId) return false
  if (typeof payload.exp_unix !== 'number') return false
  if (payload.exp_unix < Math.floor(Date.now() / 1000)) return false
  return true
}
```

- [ ] **Step 4:** Correr tests
```bash
deno test supabase/functions/_shared/gateToken_test.ts
```
Expected: 5 passed.

- [ ] **Step 5:** Commit
```bash
git add supabase/functions/_shared/gateToken.ts supabase/functions/_shared/gateToken_test.ts
git commit -m "feat(edge): helper signGateToken/verifyGateToken con tests"
```

---

## Task 3: Helper `_shared/cors.ts`

**Files:**
- Crear: `supabase/functions/_shared/cors.ts` (si no existe ya)

- [ ] **Step 1:** Verificar si ya existe
```bash
ls supabase/functions/_shared/cors.ts 2>/dev/null
```

- [ ] **Step 2:** Si no existe, crearlo
```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
```

- [ ] **Step 3:** Commit
```bash
git add supabase/functions/_shared/cors.ts
git commit -m "feat(edge): helper cors compartido"
```

---

## Task 4: Edge Function `passkey-register-begin`

**Files:**
- Crear: `supabase/functions/passkey-register-begin/index.ts`

- [ ] **Step 1:** Implementación
```ts
// supabase/functions/passkey-register-begin/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateRegistrationOptions } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: existing } = await admin
    .from('user_passkeys')
    .select('credential_id, transports')
    .eq('user_id', u.user.id)

  const options = await generateRegistrationOptions({
    rpName: Deno.env.get('WEBAUTHN_RP_NAME') ?? 'SecurePayNet',
    rpID: Deno.env.get('WEBAUTHN_RP_ID') ?? 'securepaynet-wallet.vercel.app',
    userID: new TextEncoder().encode(u.user.id),
    userName: u.user.email ?? u.user.id,
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  const { error: insErr } = await admin.from('webauthn_challenges').insert({
    user_id: u.user.id,
    challenge: options.challenge,
    type: 'register',
  })
  if (insErr) return jsonErr(500, insErr.message)

  return new Response(JSON.stringify({ ok: true, options }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    status: 200,
  })
})

type AuthenticatorTransportFuture = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'smart-card'

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Type-check
```bash
deno check supabase/functions/passkey-register-begin/index.ts
```

- [ ] **Step 3:** Commit
```bash
git add supabase/functions/passkey-register-begin/index.ts
git commit -m "feat(edge): passkey-register-begin"
```

---

## Task 5: Edge Function `passkey-register-finish`

**Files:**
- Crear: `supabase/functions/passkey-register-finish/index.ts`

- [ ] **Step 1:** Implementación
```ts
// supabase/functions/passkey-register-finish/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyRegistrationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return jsonErr(401, 'unauthenticated')

  const body = (await req.json()) as { credential: unknown; deviceName?: string }
  if (!body.credential) return jsonErr(400, 'credential requerido')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('id, challenge, expires_at')
    .eq('user_id', u.user.id)
    .eq('type', 'register')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ch) return jsonErr(401, 'challenge expirado o inexistente')

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: ch.challenge,
      expectedOrigin: Deno.env.get('WEBAUTHN_ORIGIN')!,
      expectedRPID: Deno.env.get('WEBAUTHN_RP_ID')!,
    })
  } catch (e) {
    return jsonErr(401, `verificacion fallida: ${(e as Error).message}`)
  }
  if (!verification.verified || !verification.registrationInfo) {
    return jsonErr(401, 'verificacion fallida')
  }

  const info = verification.registrationInfo
  const credId = info.credential.id
  const publicKey = info.credential.publicKey

  const { error: insErr } = await admin.from('user_passkeys').insert({
    user_id: u.user.id,
    credential_id: credId,
    public_key: publicKey,
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    device_name: body.deviceName ?? null,
  })
  if (insErr) return jsonErr(500, `insert error: ${insErr.message}`)

  await admin.from('webauthn_challenges').delete().eq('id', ch.id)

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Type-check
```bash
deno check supabase/functions/passkey-register-finish/index.ts
```

- [ ] **Step 3:** Commit
```bash
git add supabase/functions/passkey-register-finish/index.ts
git commit -m "feat(edge): passkey-register-finish"
```

---

## Task 6: Edge Function `passkey-auth-begin`

**Files:**
- Crear: `supabase/functions/passkey-auth-begin/index.ts`

- [ ] **Step 1:** Implementación
```ts
// supabase/functions/passkey-auth-begin/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateAuthenticationOptions } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return jsonErr(401, 'unauthenticated')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: passkeys } = await admin
    .from('user_passkeys')
    .select('credential_id, transports')
    .eq('user_id', u.user.id)

  if (!passkeys || passkeys.length === 0) {
    return new Response(JSON.stringify({ ok: false, code: 'NO_PASSKEYS' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const options = await generateAuthenticationOptions({
    rpID: Deno.env.get('WEBAUTHN_RP_ID')!,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: passkeys.map((p) => ({
      id: p.credential_id,
      transports: (p.transports ?? []) as AuthenticatorTransportFuture[],
    })),
  })

  await admin.from('webauthn_challenges').insert({
    user_id: u.user.id,
    challenge: options.challenge,
    type: 'auth',
  })

  return new Response(JSON.stringify({ ok: true, options }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})

type AuthenticatorTransportFuture = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'smart-card'

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Commit
```bash
git add supabase/functions/passkey-auth-begin/index.ts
git commit -m "feat(edge): passkey-auth-begin"
```

---

## Task 7: Edge Function `passkey-auth-finish`

**Files:**
- Crear: `supabase/functions/passkey-auth-finish/index.ts`

- [ ] **Step 1:** Implementación
```ts
// supabase/functions/passkey-auth-finish/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyAuthenticationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'
import { signGateToken } from '../_shared/gateToken.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return jsonErr(401, 'unauthenticated')

  const body = (await req.json()) as { credential: { id: string; [k: string]: unknown } }
  if (!body.credential?.id) return jsonErr(400, 'credential requerido')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('id, challenge')
    .eq('user_id', u.user.id)
    .eq('type', 'auth')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ch) return jsonErr(401, 'challenge expirado o inexistente')

  const { data: pk } = await admin
    .from('user_passkeys')
    .select('id, credential_id, public_key, counter, transports')
    .eq('credential_id', body.credential.id)
    .eq('user_id', u.user.id)
    .maybeSingle()
  if (!pk) return jsonErr(401, 'credencial no registrada para este usuario')

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: ch.challenge,
      expectedOrigin: Deno.env.get('WEBAUTHN_ORIGIN')!,
      expectedRPID: Deno.env.get('WEBAUTHN_RP_ID')!,
      credential: {
        id: pk.credential_id,
        publicKey: new Uint8Array(pk.public_key),
        counter: Number(pk.counter),
        transports: pk.transports ?? [],
      },
    })
  } catch (e) {
    return jsonErr(401, `verificacion fallida: ${(e as Error).message}`)
  }

  if (!verification.verified) return jsonErr(401, 'verificacion fallida')

  const newCounter = verification.authenticationInfo.newCounter
  const { data: updated, error: updErr } = await admin
    .from('user_passkeys')
    .update({ counter: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', pk.id)
    .lt('counter', newCounter)
    .select('id')
    .maybeSingle()
  if (updErr) return jsonErr(500, updErr.message)

  // Si counter no avanzo, podria ser clonacion (o newCounter=0 que algunos authenticators usan).
  if (!updated && newCounter > 0) {
    return new Response(JSON.stringify({ ok: false, code: 'CLONED_CREDENTIAL', message: 'Posible clonacion detectada' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  await admin.from('webauthn_challenges').delete().eq('id', ch.id)

  const secret = Deno.env.get('GATE_TOKEN_SECRET')!
  const gateToken = await signGateToken(u.user.id, 60, secret)

  return new Response(JSON.stringify({ ok: true, gateToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Commit
```bash
git add supabase/functions/passkey-auth-finish/index.ts
git commit -m "feat(edge): passkey-auth-finish con counter check + gate_token"
```

---

## Task 8: Edge Function `gate-password`

**Files:**
- Crear: `supabase/functions/gate-password/index.ts`

- [ ] **Step 1:** Implementación
```ts
// supabase/functions/gate-password/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { signGateToken } from '../_shared/gateToken.ts'

const MAX_FAILS_PER_WINDOW = 5
const WINDOW_MINUTES = 10
const BLOCK_MINUTES = 15

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user || !u.user.email) return jsonErr(401, 'unauthenticated')

  const body = (await req.json()) as { password?: string }
  if (!body.password) return jsonErr(400, 'password requerido')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Rate limit
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { data: fails } = await admin
    .from('gate_password_attempts')
    .select('id, created_at')
    .eq('user_id', u.user.id)
    .eq('success', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (fails && fails.length >= MAX_FAILS_PER_WINDOW) {
    const oldest = fails[fails.length - 1]
    const blockUntil = new Date(new Date(oldest.created_at).getTime() + BLOCK_MINUTES * 60_000)
    if (new Date() < blockUntil) {
      return new Response(JSON.stringify({
        ok: false, code: 'RATE_LIMITED',
        message: `Demasiados intentos. Intenta de nuevo despues de ${blockUntil.toISOString()}`,
      }), { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
    }
  }

  // Verificar password con cliente separado (no afecta sesion del browser)
  const verifier = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: signinErr } = await verifier.auth.signInWithPassword({
    email: u.user.email,
    password: body.password,
  })
  await admin.from('gate_password_attempts').insert({ user_id: u.user.id, success: !signinErr })

  if (signinErr) return jsonErr(401, 'Contrasena incorrecta')

  const gateToken = await signGateToken(u.user.id, 60, Deno.env.get('GATE_TOKEN_SECRET')!)
  return new Response(JSON.stringify({ ok: true, gateToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Commit
```bash
git add supabase/functions/gate-password/index.ts
git commit -m "feat(edge): gate-password con rate-limit y cliente separado"
```

---

## Task 9: Setear secrets de Edge Functions y deploy

**Files:** ninguno (configuración + deploy).

- [ ] **Step 1:** Setear los secrets en Supabase
```bash
PROJECT_REF=lkqyzyvfcnfzihhlhuru
SECRET_VALUE=$(grep GATE_TOKEN_SECRET /tmp/secrets-to-add.env | cut -d= -f2-)

npx supabase secrets set --project-ref $PROJECT_REF \
  WEBAUTHN_RP_ID=securepaynet-wallet.vercel.app \
  WEBAUTHN_RP_NAME=SecurePayNet \
  WEBAUTHN_ORIGIN=https://securepaynet-wallet.vercel.app \
  GATE_TOKEN_SECRET="$SECRET_VALUE"
```
Expected: `Secrets updated`.

- [ ] **Step 2:** Deploy de cada función
```bash
npx supabase functions deploy passkey-register-begin --project-ref $PROJECT_REF
npx supabase functions deploy passkey-register-finish --project-ref $PROJECT_REF
npx supabase functions deploy passkey-auth-begin --project-ref $PROJECT_REF
npx supabase functions deploy passkey-auth-finish --project-ref $PROJECT_REF
npx supabase functions deploy gate-password --project-ref $PROJECT_REF
```
Expected: 5 funciones deployed sin errores.

- [ ] **Step 3:** Smoke test de `passkey-auth-begin` con un usuario sin passkeys
```bash
JWT="<token de un usuario>"
curl -s -X POST https://lkqyzyvfcnfzihhlhuru.supabase.co/functions/v1/passkey-auth-begin \
  -H "Authorization: Bearer $JWT"
```
Expected: `{"ok":false,"code":"NO_PASSKEYS"}`.

---

## Task 10: Agregar `@simplewebauthn/browser` y crear `src/lib/webauthn.ts`

**Files:**
- Modificar: `package.json`
- Crear: `src/lib/webauthn.ts`

- [ ] **Step 1:** Instalar
```bash
npm install @simplewebauthn/browser@10.0.0
```

- [ ] **Step 2:** Crear helper
```ts
// src/lib/webauthn.ts
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser'

export const isWebAuthnSupported = () => browserSupportsWebAuthn()

export async function registerCredential(options: Parameters<typeof startRegistration>[0]['optionsJSON']) {
  return await startRegistration({ optionsJSON: options })
}

export async function authenticateCredential(options: Parameters<typeof startAuthentication>[0]['optionsJSON']) {
  return await startAuthentication({ optionsJSON: options })
}

export function detectDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Dispositivo'
}
```

- [ ] **Step 3:** Type-check
```bash
npx tsc -b
```

- [ ] **Step 4:** Commit
```bash
git add package.json package-lock.json src/lib/webauthn.ts
git commit -m "feat(front): @simplewebauthn/browser + helper webauthn"
```

---

## Task 11: `src/services/passkeyService.ts`

**Files:**
- Crear: `src/services/passkeyService.ts`

- [ ] **Step 1:** Implementación
```ts
// src/services/passkeyService.ts
import { supabase } from '../lib/supabase'
import {
  isWebAuthnSupported,
  registerCredential,
  authenticateCredential,
  detectDeviceName,
} from '../lib/webauthn'

export type Passkey = {
  id: string
  user_id: string
  credential_id: string
  transports: string[] | null
  device_name: string | null
  created_at: string
  last_used_at: string | null
}

export const passkeyService = {
  isWebAuthnSupported,

  async list(): Promise<Passkey[]> {
    const { data, error } = await supabase
      .from('user_passkeys')
      .select('id, user_id, credential_id, transports, device_name, created_at, last_used_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as Passkey[]
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('user_passkeys').delete().eq('id', id)
    if (error) throw error
  },

  async registerCurrentDevice(deviceName?: string): Promise<void> {
    const { data: begin, error: e1 } = await supabase.functions.invoke('passkey-register-begin', { body: {} })
    if (e1 || !begin?.ok) throw new Error(e1?.message ?? begin?.message ?? 'Error al iniciar registro')

    const credential = await registerCredential(begin.options)

    const { data: finish, error: e2 } = await supabase.functions.invoke('passkey-register-finish', {
      body: { credential, deviceName: deviceName ?? detectDeviceName() },
    })
    if (e2 || !finish?.ok) throw new Error(e2?.message ?? finish?.message ?? 'Error al finalizar registro')
  },

  async authenticate(): Promise<{ gateToken: string }> {
    const { data: begin, error: e1 } = await supabase.functions.invoke('passkey-auth-begin', { body: {} })
    if (e1) throw new Error(e1.message)
    if (!begin?.ok) throw new Error(begin?.code === 'NO_PASSKEYS' ? 'NO_PASSKEYS' : (begin?.message ?? 'Error'))

    const credential = await authenticateCredential(begin.options)

    const { data: finish, error: e2 } = await supabase.functions.invoke('passkey-auth-finish', {
      body: { credential },
    })
    if (e2 || !finish?.ok) {
      const code = finish?.code ?? 'AUTH_FAILED'
      throw new Error(code === 'CLONED_CREDENTIAL' ? 'CLONED_CREDENTIAL' : (e2?.message ?? finish?.message ?? 'Auth fallido'))
    }
    return { gateToken: finish.gateToken }
  },

  async authenticateWithPassword(password: string): Promise<{ gateToken: string }> {
    const { data, error } = await supabase.functions.invoke('gate-password', { body: { password } })
    if (error || !data?.ok) {
      const code = data?.code ?? 'AUTH_FAILED'
      if (code === 'RATE_LIMITED') throw new Error('RATE_LIMITED')
      throw new Error(error?.message ?? data?.message ?? 'Contrasena incorrecta')
    }
    return { gateToken: data.gateToken }
  },
}
```

- [ ] **Step 2:** Type-check
```bash
npx tsc -b
```

- [ ] **Step 3:** Commit
```bash
git add src/services/passkeyService.ts
git commit -m "feat(front): passkeyService"
```

---

## Task 12: Sección "Passkeys" en `Perfil.tsx`

**Files:**
- Modificar: `src/pages/Perfil.tsx`

- [ ] **Step 1:** Leer el archivo entero para conocer su estructura
```bash
cat src/pages/Perfil.tsx
```

- [ ] **Step 2:** Agregar imports al tope
```ts
import { useEffect, useState } from 'react'
import { passkeyService, type Passkey } from '../services/passkeyService'
```
(reemplazá los imports existentes manteniendo lo que ya estaba, agregá lo nuevo).

- [ ] **Step 3:** Agregar componente al final del archivo (antes del `export default`)
```tsx
function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const supported = passkeyService.isWebAuthnSupported()

  async function refresh() {
    setLoading(true)
    try {
      setPasskeys(await passkeyService.list())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  async function handleRegister() {
    setErr(null)
    setRegistering(true)
    try {
      await passkeyService.registerCurrentDevice()
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRegistering(false)
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Eliminar este dispositivo? Vas a tener que usar contrasena la proxima vez.')) return
    try {
      await passkeyService.remove(id)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4">
      <h2 className="text-sm font-bold mb-1">Dispositivos confiables (Passkeys)</h2>
      <p className="text-xs text-slate-500 mb-3">
        Permite confirmar operaciones sensibles con tu huella, Face ID o PIN del dispositivo, sin escribir la contrasena.
      </p>

      {!supported && (
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
          Tu navegador no soporta passkeys.
        </div>
      )}

      {supported && loading && <div className="text-xs text-slate-400">Cargando...</div>}

      {supported && !loading && passkeys.length === 0 && (
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 mb-3">
          No tenes passkeys registradas. Te vamos a pedir contrasena en cada operacion sensible.
        </div>
      )}

      {supported && passkeys.length > 0 && (
        <ul className="space-y-2 mb-3">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between border border-slate-100 rounded-lg p-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{p.device_name ?? 'Dispositivo'}</div>
                <div className="text-[11px] text-slate-500">
                  Registrado {new Date(p.created_at).toLocaleDateString('es-AR')}
                  {p.last_used_at ? ` · Ultimo uso ${new Date(p.last_used_at).toLocaleDateString('es-AR')}` : ''}
                </div>
              </div>
              <button
                onClick={() => handleRemove(p.id)}
                className="text-xs text-red-600 font-semibold px-2 py-1 hover:bg-red-50 rounded"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported && (
        <button
          onClick={handleRegister}
          disabled={registering}
          className="w-full text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl disabled:opacity-50"
        >
          {registering ? 'Registrando...' : '+ Registrar este dispositivo'}
        </button>
      )}

      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </section>
  )
}
```

- [ ] **Step 4:** Insertar `<PasskeysSection />` en el render del componente Perfil principal, en una posición lógica (probablemente al final del flex/grid de tarjetas).

- [ ] **Step 5:** Build
```bash
npm run build
```
Expected: build OK.

- [ ] **Step 6:** Commit
```bash
git add src/pages/Perfil.tsx
git commit -m "feat(perfil): seccion de passkeys con registro/listado/eliminacion"
```

---

## Task 13: Test E2E manual

**Files:** ninguno.

- [ ] **Step 1:** Levantar dev server
```bash
npm run dev
```

- [ ] **Step 2:** Loguearte en la app, ir a `/perfil`, verificar que aparece la sección "Dispositivos confiables".

- [ ] **Step 3:** Click en "+ Registrar este dispositivo". Aparece prompt biométrico del SO. Aceptar. Verificar que aparece el dispositivo en la lista.

- [ ] **Step 4:** En consola del browser, ejecutar:
```javascript
const { passkeyService } = await import('./src/services/passkeyService.ts')
const r = await passkeyService.authenticate()
console.log(r) // debe loggear {gateToken: '...'}
```

- [ ] **Step 5:** Click en "Eliminar" del passkey registrado. Confirmar. Verificar que desaparece.

---

## Task 14: PR

- [ ] **Step 1:** Push y abrir PR
```bash
git push -u origin feat/passkey-infra
gh pr create --title "feat(passkeys): infraestructura WebAuthn (sin enforcing)" --body "$(cat <<'EOF'
## Summary
- Migracion: tablas user_passkeys, webauthn_challenges, gate_password_attempts (RLS estricta)
- 5 Edge Functions: passkey-register-begin/finish, passkey-auth-begin/finish, gate-password
- Helper _shared/gateToken.ts (HMAC sign/verify) con tests
- Front: passkeyService + seccion en Perfil
- Sin enforcing del gate todavia (Plan 3 lo agrega)

## Test plan
- [x] Deno tests gateToken: round-trip, tampering, secreto incorrecto, user mismatch, expirado
- [x] Smoke test passkey-auth-begin con user sin passkeys (NO_PASSKEYS)
- [x] Manual: registro de passkey en mobile + desktop
- [x] Manual: authenticate() devuelve gateToken
- [x] Manual: eliminar passkey
- [ ] Aprobado

Spec: docs/superpowers/specs/2026-04-27-cuenta-lookup-y-passkeys-design.md (3.2, 4.3, 4.4, 5.4)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2:** Vercel preview test, merge con squash, borrar branch.

---

## Verificación final del Plan 2

- [ ] Migración aplicada y verificada en Supabase prod
- [ ] `app.gate_token_secret` seteado en PG y `GATE_TOKEN_SECRET` seteado en Edge Functions con el MISMO valor
- [ ] Las 5 Edge Functions deployed
- [ ] Usuario puede registrar/listar/eliminar passkeys desde Perfil
- [ ] `passkeyService.authenticate()` y `authenticateWithPassword()` devuelven `gateToken` válido
- [ ] PR mergeado a main

**Próximo plan:** `2026-04-27-agenda-obligatoria.md`
