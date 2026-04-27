# Onboarding Rápido + Passkey-Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar alta de cuenta para testers (Google + email/password con OTP, $5.000 mock balance, registro opcional de passkey) y login passwordless con passkey desde frío.

**Architecture:** 3 Edge Functions nuevas (`onboarding-complete` con JWT, `passkey-login-begin` y `passkey-login-finish` anónimas), 1 helper Deno (`cuitMock`), 1 migración SQL (UNIQUE en `clientes.auth_user_id`), 1 service front nuevo (`onboardingService`), 1 page nueva (`/signup` wizard), modificaciones a `Login.tsx`, `useAuth.ts`, `passkeyService.ts`, `App.tsx`. Sesión post-passkey via `auth.admin.generateLink({ type: 'magiclink' })` consumido por `verifyOtp({ token_hash, type: 'magiclink' })`.

**Tech Stack:** Deno (Edge Functions), TypeScript/React (front), Supabase Auth + Admin API, `@simplewebauthn/server@^10.0.x` (Edge), `@simplewebauthn/browser@^10.0.0` (front), Vite, Tailwind.

**Spec de referencia:** `docs/superpowers/specs/2026-04-27-onboarding-rapido-design.md`.

**Working directory:** `/home/tron/securepaynet-app/.worktrees/onboarding-rapido` (worktree creado por el orquestador). **NO crear branch dentro del plan** — la rama `feat/onboarding-rapido` ya existe y el worktree ya está en ella.

**Supabase project ref:** `lkqyzyvfcnfzihhlhuru`. Token en `~/.supabase/access-token`.

---

## File Structure

| Path | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260428_onboarding_constraints.sql` | Crear + aplicar | UNIQUE(`auth_user_id`) en `clientes` |
| `supabase/functions/_shared/cuitMock.ts` | Crear | Generar CUIT válido determinístico desde uid + attempt |
| `supabase/functions/_shared/cuitMock_test.ts` | Crear | Tests del helper |
| `supabase/functions/onboarding-complete/index.ts` | Crear | Crea cliente + wallet con stubs (idempotente) |
| `supabase/functions/passkey-login-begin/index.ts` | Crear | Anónima: genera options de WebAuthn por email |
| `supabase/functions/passkey-login-finish/index.ts` | Crear | Anónima: verifica + emite hashed_token magiclink |
| `src/services/onboardingService.ts` | Crear | Wrappers de signUp/verifyOtp/signInWithOAuth + Edge Function |
| `src/services/passkeyService.ts` | Modificar | Agregar `loginBegin(email)` y `loginFinish(email, credential)` |
| `src/store/useAuth.ts` | Modificar | Agregar `signUpWithEmail`, `verifyEmailOtp`, `signInWithGoogle`, `signInWithPasskey`, recovery via sessionStorage flag |
| `src/pages/Signup.tsx` | Crear | Wizard 3 pasos (choose-method → form/OTP → passkey-prompt) |
| `src/pages/Login.tsx` | Modificar | CTA "Crear cuenta" + cablear botón passkey real |
| `src/App.tsx` | Modificar | Agregar `<Route path="/signup" element={<Signup />} />` |

---

## Task 1: Migración SQL — UNIQUE en `clientes.auth_user_id`

**Files:**
- Crear: `supabase/migrations/20260428_onboarding_constraints.sql`
- Aplicar a Supabase prod via Management API

- [ ] **Step 1:** Crear el archivo de migración

Crear `supabase/migrations/20260428_onboarding_constraints.sql`:
```sql
-- supabase/migrations/20260428_onboarding_constraints.sql
-- Asegura idempotencia del onboarding-complete:
-- el ON CONFLICT DO NOTHING en clientes(auth_user_id) requiere UNIQUE.

ALTER TABLE clientes
  ADD CONSTRAINT clientes_auth_user_id_unique UNIQUE (auth_user_id);
```

- [ ] **Step 2:** Aplicar al Supabase prod via Management API

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
TOKEN=$(cat ~/.supabase/access-token)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/database/query" \
  -d '{"query":"ALTER TABLE clientes ADD CONSTRAINT clientes_auth_user_id_unique UNIQUE (auth_user_id);"}'
```
Expected: `[]` (success — no rows returned).

- [ ] **Step 3:** Verificar constraint aplicado

```bash
TOKEN=$(cat ~/.supabase/access-token)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/database/query" \
  -d '{"query":"SELECT conname FROM pg_constraint WHERE conrelid='"'"'clientes'"'"'::regclass AND contype='"'"'u'"'"';"}'
```
Expected: `[{"conname":"clientes_auth_user_id_unique"}]`.

- [ ] **Step 4:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add supabase/migrations/20260428_onboarding_constraints.sql
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(db): UNIQUE clientes.auth_user_id para idempotencia onboarding"
```

---

## Task 2: Helper `_shared/cuitMock.ts` con tests

**Files:**
- Crear: `supabase/functions/_shared/cuitMock.ts`
- Crear: `supabase/functions/_shared/cuitMock_test.ts`

Re-usa `cuitCheckDigit` de `_shared/cuit.ts` (Plan 1 ya commiteado en main).

- [ ] **Step 1:** Escribir el test primero (TDD)

Crear `supabase/functions/_shared/cuitMock_test.ts`:
```ts
import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cuitMock } from './cuitMock.ts'
import { cuitCheckDigit } from './cuit.ts'

const SAMPLE_UID = '11111111-2222-3333-4444-555555555555'

Deno.test('cuitMock empieza con prefijo 20 (persona fisica)', () => {
  const c = cuitMock(SAMPLE_UID, 0)
  assertEquals(c.startsWith('20'), true)
  assertEquals(c.length, 11)
})

Deno.test('cuitMock tiene digito verificador correcto', () => {
  const c = cuitMock(SAMPLE_UID, 0)
  const base = c.slice(0, 10)
  const expectedDigit = cuitCheckDigit(base)
  assertEquals(c, base + String(expectedDigit))
})

Deno.test('cuitMock es deterministico para mismo uid+attempt', () => {
  const a = cuitMock(SAMPLE_UID, 0)
  const b = cuitMock(SAMPLE_UID, 0)
  assertEquals(a, b)
})

Deno.test('cuitMock con attempt distinto da CUIT distinto', () => {
  const a = cuitMock(SAMPLE_UID, 0)
  const b = cuitMock(SAMPLE_UID, 1)
  assertNotEquals(a, b)
})

Deno.test('cuitMock con uid distinto da CUIT distinto', () => {
  const a = cuitMock('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 0)
  const b = cuitMock('11111111-2222-3333-4444-555555555555', 0)
  assertNotEquals(a, b)
})
```

- [ ] **Step 2:** Correr el test (debe fallar — no existe el modulo)

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
deno test --allow-all supabase/functions/_shared/cuitMock_test.ts
```
Expected: FAIL con "Module not found" o similar.

- [ ] **Step 3:** Implementar `cuitMock.ts`

Crear `supabase/functions/_shared/cuitMock.ts`:
```ts
// supabase/functions/_shared/cuitMock.ts
// Genera CUIT mock con digito verificador valido,
// deterministico desde auth_user_id + attempt.
// Solo para cuentas de testing - NO usar en produccion KYC real.

import { cuitCheckDigit } from './cuit.ts'

/**
 * Genera CUIT mock valido para una cuenta de test.
 *
 * Formato: '20' + 8 digitos derivados de SHA-256(uid + attempt) + digito verificador BCRA.
 * Prefijo 20 = persona fisica masculina (convencion BCRA).
 *
 * @param authUserId - UUID del auth.users
 * @param attempt - 0 para primer intento, incrementar en colisiones UNIQUE
 * @returns CUIT de 11 digitos
 */
export async function cuitMock(authUserId: string, attempt: number): Promise<string> {
  const seed = `${authUserId}|${attempt}`
  const data = new TextEncoder().encode(seed)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  const hashBytes = new Uint8Array(hashBuf)
  // Tomar primeros 8 bytes y convertir a numero, modulo 10^8
  let n = 0n
  for (let i = 0; i < 8; i++) n = n * 256n + BigInt(hashBytes[i])
  const eightDigits = (n % 100000000n).toString().padStart(8, '0')
  const base = '20' + eightDigits
  const dv = cuitCheckDigit(base)
  return base + String(dv)
}
```

**Nota:** `cuitMock` es `async` (porque `crypto.subtle.digest` es async). Los tests del Step 1 NO usan `await` — refactorear los tests para que sean async.

- [ ] **Step 4:** Refactorear tests para que sean async

Reemplazar el contenido de `supabase/functions/_shared/cuitMock_test.ts` con:
```ts
import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cuitMock } from './cuitMock.ts'
import { cuitCheckDigit } from './cuit.ts'

const SAMPLE_UID = '11111111-2222-3333-4444-555555555555'

Deno.test('cuitMock empieza con prefijo 20 (persona fisica)', async () => {
  const c = await cuitMock(SAMPLE_UID, 0)
  assertEquals(c.startsWith('20'), true)
  assertEquals(c.length, 11)
})

Deno.test('cuitMock tiene digito verificador correcto', async () => {
  const c = await cuitMock(SAMPLE_UID, 0)
  const base = c.slice(0, 10)
  const expectedDigit = cuitCheckDigit(base)
  assertEquals(c, base + String(expectedDigit))
})

Deno.test('cuitMock es deterministico para mismo uid+attempt', async () => {
  const a = await cuitMock(SAMPLE_UID, 0)
  const b = await cuitMock(SAMPLE_UID, 0)
  assertEquals(a, b)
})

Deno.test('cuitMock con attempt distinto da CUIT distinto', async () => {
  const a = await cuitMock(SAMPLE_UID, 0)
  const b = await cuitMock(SAMPLE_UID, 1)
  assertNotEquals(a, b)
})

Deno.test('cuitMock con uid distinto da CUIT distinto', async () => {
  const a = await cuitMock('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 0)
  const b = await cuitMock('11111111-2222-3333-4444-555555555555', 0)
  assertNotEquals(a, b)
})
```

- [ ] **Step 5:** Correr tests — deben pasar

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
deno test --allow-all supabase/functions/_shared/cuitMock_test.ts
```
Expected: PASS — 5 tests passed.

- [ ] **Step 6:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add supabase/functions/_shared/cuitMock.ts supabase/functions/_shared/cuitMock_test.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(edge): helper cuitMock para stub onboarding"
```

---

## Task 3: Edge Function `onboarding-complete`

**Files:**
- Crear: `supabase/functions/onboarding-complete/index.ts`
- Deploy

- [ ] **Step 1:** Crear el archivo

Crear `supabase/functions/onboarding-complete/index.ts`:
```ts
// supabase/functions/onboarding-complete/index.ts
// POST con Bearer JWT del usuario recien creado.
// Crea clientes + wallets con stubs si no existen. Idempotente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { cuitMock } from '../_shared/cuitMock.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  // Validar JWT del usuario
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const authUid = u.user.id
  const email = u.user.email
  if (!email) return jsonErr(400, 'user has no email')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Step 1: cliente ya existe?
  const { data: existing, error: selErr } = await admin
    .from('clientes')
    .select('id')
    .eq('auth_user_id', authUid)
    .maybeSingle()
  if (selErr) return jsonErr(500, selErr.message)

  let clienteId: string
  let created = false

  if (existing) {
    clienteId = existing.id
  } else {
    // Crear cliente con retry de CUIT
    const localPart = email.split('@')[0].slice(0, 50)
    let inserted: { id: string } | null = null
    let lastErr: Error | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const cuit = await cuitMock(authUid, attempt)
      const { data, error } = await admin
        .from('clientes')
        .insert({
          auth_user_id: authUid,
          email,
          nombre: localPart,
          apellido: 'Test',
          cuit,
          tipo: 'persona_fisica',
        })
        .select('id')
        .maybeSingle()
      if (data) {
        inserted = data
        break
      }
      lastErr = error ? new Error(error.message) : null
      // Si fue UNIQUE violation por auth_user_id (otro proceso lo creo), buscar y salir
      if (error?.message?.includes('clientes_auth_user_id_unique')) {
        const { data: race } = await admin
          .from('clientes').select('id').eq('auth_user_id', authUid).maybeSingle()
        if (race) {
          inserted = race
          break
        }
      }
      // Si fue UNIQUE en cuit, retry con attempt+1
      if (error?.message?.includes('cuit') || error?.code === '23505') continue
      // Otro error: abortar
      return jsonErr(500, `cliente insert failed: ${error?.message}`)
    }
    if (!inserted) return jsonErr(500, `cliente insert failed after retries: ${lastErr?.message}`)
    clienteId = inserted.id
    created = true
  }

  // Step 2: wallet ya existe?
  const { data: existingWallet } = await admin
    .from('wallets')
    .select('cvu, alias, saldo, moneda')
    .eq('cliente_id', clienteId)
    .maybeSingle()

  let wallet = existingWallet
  if (!wallet) {
    // Crear wallet con stub
    const cvu = await mockCvu(authUid)
    const alias = `test.${clienteId.replace(/-/g, '').slice(0, 8)}.spn`
    const { data: insWallet, error: insWalletErr } = await admin
      .from('wallets')
      .insert({
        cliente_id: clienteId,
        saldo: 5000,
        moneda: 'ARS',
        cvu,
        alias,
      })
      .select('cvu, alias, saldo, moneda')
      .maybeSingle()
    if (insWalletErr) {
      // Si race condition, leer el existente
      const { data: race } = await admin
        .from('wallets').select('cvu, alias, saldo, moneda').eq('cliente_id', clienteId).maybeSingle()
      if (race) wallet = race
      else return jsonErr(500, `wallet insert failed: ${insWalletErr.message}`)
    } else {
      wallet = insWallet
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    cliente_id: clienteId,
    wallet,
    created,
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    status: 200,
  })
})

async function mockCvu(authUid: string): Promise<string> {
  // Formato CVU: 22 digitos. Prefijo '0000003' (mock) + 15 digitos derivados.
  const data = new TextEncoder().encode(`cvu|${authUid}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let n = 0n
  for (let i = 0; i < 8; i++) n = n * 256n + BigInt(bytes[i])
  const fifteenDigits = (n % 1000000000000000n).toString().padStart(15, '0')
  return '0000003' + fifteenDigits
}

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Deploy a Supabase

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx supabase functions deploy onboarding-complete --project-ref lkqyzyvfcnfzihhlhuru
```
Expected: `Deployed Functions on project lkqyzyvfcnfzihhlhuru: onboarding-complete`.

- [ ] **Step 3:** Verificar el deploy listando funciones

```bash
TOKEN=$(cat ~/.supabase/access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/functions" \
  | grep -o '"slug":"onboarding-complete"'
```
Expected: `"slug":"onboarding-complete"`.

- [ ] **Step 4:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add supabase/functions/onboarding-complete/index.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(edge): onboarding-complete crea cliente+wallet con stubs"
```

---

## Task 4: Edge Function `passkey-login-begin`

**Files:**
- Crear: `supabase/functions/passkey-login-begin/index.ts`
- Deploy

- [ ] **Step 1:** Crear el archivo

Crear `supabase/functions/passkey-login-begin/index.ts`:
```ts
// supabase/functions/passkey-login-begin/index.ts
// ANONIMO: recibe { email }, devuelve options de WebAuthn para login.
// Usa email-first (no discoverable credentials) para max compatibilidad.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateAuthenticationOptions } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  let body: { email?: string }
  try { body = await req.json() } catch { return jsonErr(400, 'invalid json') }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return jsonErr(400, 'invalid email')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Buscar user_id por email (admin API)
  const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const user = usersList?.users?.find((u) => u.email?.toLowerCase() === email)

  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = []

  if (user) {
    const { data: passkeys } = await admin
      .from('user_passkeys')
      .select('credential_id, transports')
      .eq('user_id', user.id)
    allowCredentials = (passkeys ?? []).map((p) => ({
      id: p.credential_id,
      transports: (p.transports ?? []) as AuthenticatorTransportFuture[],
    }))
  }

  const options = await generateAuthenticationOptions({
    rpID: Deno.env.get('WEBAUTHN_RP_ID') ?? 'securepaynet-wallet.vercel.app',
    allowCredentials,
    userVerification: 'preferred',
    timeout: 60000,
  })

  // Solo persistimos challenge si user existe (sino el login va a fallar igual al verificar)
  if (user) {
    const { error: insErr } = await admin.from('webauthn_challenges').insert({
      user_id: user.id,
      challenge: options.challenge,
      type: 'login',
    })
    if (insErr) return jsonErr(500, insErr.message)
  }

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

- [ ] **Step 2:** Deploy con flag `--no-verify-jwt` (Edge Function anónima)

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx supabase functions deploy passkey-login-begin --project-ref lkqyzyvfcnfzihhlhuru --no-verify-jwt
```
Expected: `Deployed Functions on project lkqyzyvfcnfzihhlhuru: passkey-login-begin`.

- [ ] **Step 3:** Smoke test contra deploy (con email inexistente — debe devolver options vacios)

```bash
SUPA_URL="https://lkqyzyvfcnfzihhlhuru.supabase.co"
ANON=$(TOKEN=$(cat ~/.supabase/access-token); curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/api-keys" \
  | python3 -c "import sys,json; print([k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'][0])")
curl -s -X POST \
  -H "Authorization: Bearer $ANON" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  "$SUPA_URL/functions/v1/passkey-login-begin" \
  -d '{"email":"nonexistent_test@example.com"}'
```
Expected: JSON con `"ok":true` y `"options":{...,"allowCredentials":[]}`.

- [ ] **Step 4:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add supabase/functions/passkey-login-begin/index.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(edge): passkey-login-begin (anonima) emite WebAuthn options"
```

---

## Task 5: Edge Function `passkey-login-finish`

**Files:**
- Crear: `supabase/functions/passkey-login-finish/index.ts`
- Deploy

- [ ] **Step 1:** Crear el archivo

Crear `supabase/functions/passkey-login-finish/index.ts`:
```ts
// supabase/functions/passkey-login-finish/index.ts
// ANONIMO: verifica WebAuthn assertion, emite hashed_token magiclink.
// El front consume con verifyOtp({ token_hash, type: 'magiclink' }).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyAuthenticationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  let body: { email?: string; credential?: any }
  try { body = await req.json() } catch { return jsonErr(400, 'invalid json') }
  const email = (body.email ?? '').trim().toLowerCase()
  const credential = body.credential
  if (!email || !email.includes('@')) return jsonErr(400, 'invalid email')
  if (!credential || typeof credential !== 'object') return jsonErr(400, 'invalid credential')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Resolver user_id por email
  const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const user = usersList?.users?.find((u) => u.email?.toLowerCase() === email)
  if (!user) return jsonErr(401, 'auth failed')

  // 2. Levantar challenge mas reciente
  const { data: challenge } = await admin
    .from('webauthn_challenges')
    .select('id, challenge, created_at')
    .eq('user_id', user.id)
    .eq('type', 'login')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!challenge) return jsonErr(401, 'no pending challenge')
  // Expirar a 5 min
  const ageMs = Date.now() - new Date(challenge.created_at).getTime()
  if (ageMs > 5 * 60 * 1000) return jsonErr(401, 'challenge expired')

  // 3. Levantar passkey por credential_id
  const { data: passkey } = await admin
    .from('user_passkeys')
    .select('id, credential_id, public_key, counter, transports')
    .eq('user_id', user.id)
    .eq('credential_id', credential.id)
    .maybeSingle()
  if (!passkey) return jsonErr(401, 'auth failed')

  // 4. Verificar assertion
  let result
  try {
    result = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: Deno.env.get('WEBAUTHN_ORIGIN') ?? 'https://securepaynet-wallet.vercel.app',
      expectedRPID: Deno.env.get('WEBAUTHN_RP_ID') ?? 'securepaynet-wallet.vercel.app',
      authenticator: {
        credentialID: passkey.credential_id,
        credentialPublicKey: passkey.public_key,
        counter: Number(passkey.counter),
        transports: passkey.transports as any,
      },
    })
  } catch (err) {
    return jsonErr(401, `verify failed: ${(err as Error).message}`)
  }
  if (!result.verified) return jsonErr(401, 'auth failed')

  const newCounter = result.authenticationInfo.newCounter
  if (newCounter <= Number(passkey.counter)) {
    return new Response(JSON.stringify({ ok: false, code: 'CLONED_CREDENTIAL', message: 'counter regression' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  // 5. UPDATE counter + last_used_at
  await admin
    .from('user_passkeys')
    .update({ counter: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', passkey.id)

  // 6. DELETE challenge (single-use)
  await admin.from('webauthn_challenges').delete().eq('id', challenge.id)

  // 7. Generar magiclink
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr || !link?.properties?.hashed_token) {
    return jsonErr(500, `magiclink generation failed: ${linkErr?.message ?? 'unknown'}`)
  }

  return new Response(JSON.stringify({
    ok: true,
    hashed_token: link.properties.hashed_token,
    type: 'magiclink',
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    status: 200,
  })
})

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
```

- [ ] **Step 2:** Deploy con `--no-verify-jwt`

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx supabase functions deploy passkey-login-finish --project-ref lkqyzyvfcnfzihhlhuru --no-verify-jwt
```
Expected: `Deployed Functions on project lkqyzyvfcnfzihhlhuru: passkey-login-finish`.

- [ ] **Step 3:** Smoke test (con email inexistente — debe devolver 401)

```bash
SUPA_URL="https://lkqyzyvfcnfzihhlhuru.supabase.co"
ANON=$(TOKEN=$(cat ~/.supabase/access-token); curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/api-keys" \
  | python3 -c "import sys,json; print([k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'][0])")
curl -s -X POST \
  -H "Authorization: Bearer $ANON" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  "$SUPA_URL/functions/v1/passkey-login-finish" \
  -d '{"email":"nonexistent_test@example.com","credential":{"id":"x","rawId":"x","response":{},"type":"public-key"}}'
```
Expected: JSON con `"ok":false,"message":"auth failed"` y status 401.

- [ ] **Step 4:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add supabase/functions/passkey-login-finish/index.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(edge): passkey-login-finish emite hashed_token magiclink"
```

---

## Task 6: Front service `onboardingService.ts`

**Files:**
- Crear: `src/services/onboardingService.ts`

- [ ] **Step 1:** Crear el archivo

Crear `src/services/onboardingService.ts`:
```ts
// src/services/onboardingService.ts
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export type OnboardingResult = {
  ok: boolean
  cliente_id?: string
  wallet?: {
    cvu: string | null
    alias: string | null
    saldo: number | null
    moneda: string | null
  }
  created?: boolean
  message?: string
}

export const onboardingService = {
  signUpWithEmail: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  },

  verifyEmailOtp: async (email: string, code: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email, token: code, type: 'email',
    })
    if (error) throw error
    return data
  },

  resendEmailOtp: async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) throw error
  },

  signInWithGoogle: async (redirectTo: string) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw error
  },

  completeOnboarding: async (): Promise<OnboardingResult> => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('No active session')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
    })
    const json = (await res.json()) as OnboardingResult
    if (!json.ok) throw new Error(json.message ?? 'Onboarding failed')
    return json
  },
}
```

- [ ] **Step 2:** Type-check

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
[ -d node_modules ] || npm install
npx tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 3:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add src/services/onboardingService.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(front): onboardingService (signUp/verifyOtp/Google/onboarding-complete)"
```

---

## Task 7: Extender `passkeyService.ts` con login methods

**Files:**
- Modificar: `src/services/passkeyService.ts`

- [ ] **Step 1:** Agregar `loginBegin` y `loginFinish` al objeto exportado

Editar `src/services/passkeyService.ts` — agregar después del método `authenticateWithPassword` (que termina con `return { gateToken: data.gateToken }`), antes del `}` final del objeto.

Insertar (manteniendo la coma después de `authenticateWithPassword`):

```ts
  async loginBegin(email: string): Promise<{ options: any }> {
    const { data, error } = await supabase.functions.invoke('passkey-login-begin', { body: { email } })
    if (error || !data?.ok) throw new Error(error?.message ?? data?.message ?? 'Login begin failed')
    return { options: data.options }
  },

  async loginFinish(email: string, credential: any): Promise<{ hashedToken: string }> {
    const { data, error } = await supabase.functions.invoke('passkey-login-finish', {
      body: { email, credential },
    })
    if (error || !data?.ok) {
      const code = data?.code ?? 'AUTH_FAILED'
      if (code === 'CLONED_CREDENTIAL') throw new Error('CLONED_CREDENTIAL')
      throw new Error(error?.message ?? data?.message ?? 'Auth failed')
    }
    return { hashedToken: data.hashed_token }
  },
```

- [ ] **Step 2:** Type-check

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 3:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add src/services/passkeyService.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(front): passkeyService.loginBegin/loginFinish"
```

---

## Task 8: Extender `useAuth.ts` con nuevas acciones + recovery

**Files:**
- Modificar: `src/store/useAuth.ts`

- [ ] **Step 1:** Reemplazar el archivo entero

Sobreescribir `src/store/useAuth.ts` con:
```ts
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { onboardingService } from '../services/onboardingService'
import { passkeyService } from '../services/passkeyService'
import { authenticateCredential } from '../lib/webauthn'

type Cliente = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  cuit: string | null
  telefono: string | null
  tipo: string | null
  cvu: string | null
  alias: string | null
  saldo: number | null
  moneda: string | null
}

type State = {
  user: { id: string; email: string } | null
  cliente: Cliente | null
  hydrating: boolean
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  verifyEmailOtp: (email: string, code: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithPasskey: (email: string) => Promise<void>
}

const ONBOARDING_FLAG = 'onboarding-pending'

async function loadCliente(authUserId: string): Promise<Cliente | null> {
  try {
    const { data: cli, error: e1 } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, email, cuit, telefono, tipo')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (e1) {
      console.error('[loadCliente] clientes error:', e1)
      return null
    }
    if (!cli) {
      console.warn('[loadCliente] no cliente found for auth_user_id', authUserId)
      return null
    }

    const { data: wal, error: e2 } = await supabase
      .from('wallets')
      .select('cvu, alias, saldo, moneda')
      .eq('cliente_id', cli.id)
      .maybeSingle()
    if (e2) console.error('[loadCliente] wallets error:', e2)

    return {
      id: cli.id,
      nombre: cli.nombre,
      apellido: cli.apellido,
      email: cli.email,
      cuit: cli.cuit,
      telefono: cli.telefono,
      tipo: cli.tipo,
      cvu: wal?.cvu ?? null,
      alias: wal?.alias ?? null,
      saldo: wal?.saldo ?? null,
      moneda: wal?.moneda ?? null,
    }
  } catch (err) {
    console.error('[loadCliente] exception:', err)
    return null
  }
}

async function loadClienteWithRecovery(authUserId: string): Promise<Cliente | null> {
  let cli = await loadCliente(authUserId)
  if (cli) return cli
  // Recovery: solo si vinimos de un flow de signup colgado
  if (typeof window !== 'undefined' && window.sessionStorage?.getItem(ONBOARDING_FLAG)) {
    try {
      await onboardingService.completeOnboarding()
      window.sessionStorage.removeItem(ONBOARDING_FLAG)
      cli = await loadCliente(authUserId)
    } catch (err) {
      console.error('[loadClienteWithRecovery] completeOnboarding failed:', err)
    }
  }
  return cli
}

export const useAuth = create<State>((set) => ({
  user: null,
  cliente: null,
  hydrating: true,

  hydrate: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        set({ user: null, cliente: null, hydrating: false })
        return
      }
      const cliente = await loadClienteWithRecovery(session.user.id)
      set({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
        hydrating: false,
      })
    } catch (err) {
      console.error('[hydrate] error:', err)
      set({ hydrating: false })
    }
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    if (data.user) {
      const cliente = await loadClienteWithRecovery(data.user.id)
      set({
        user: { id: data.user.id, email: data.user.email ?? '' },
        cliente,
      })
    }
    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(ONBOARDING_FLAG)
    set({ user: null, cliente: null })
  },

  signUpWithEmail: async (email, password) => {
    if (typeof window !== 'undefined') window.sessionStorage?.setItem(ONBOARDING_FLAG, '1')
    await onboardingService.signUpWithEmail(email, password)
  },

  verifyEmailOtp: async (email, code) => {
    await onboardingService.verifyEmailOtp(email, code)
    await onboardingService.completeOnboarding()
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(ONBOARDING_FLAG)
  },

  signInWithGoogle: async () => {
    if (typeof window !== 'undefined') window.sessionStorage?.setItem(ONBOARDING_FLAG, '1')
    const redirectTo = `${window.location.origin}/signup?step=onboarding`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  signInWithPasskey: async (email) => {
    const { options } = await passkeyService.loginBegin(email)
    const credential = await authenticateCredential(options)
    const { hashedToken } = await passkeyService.loginFinish(email, credential)
    const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
    if (error) throw error
    // listener onAuthStateChange recarga cliente
  },
}))

// Listener de cambios de sesion - NO bloquea hydrate
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    useAuth.setState({ user: null, cliente: null })
    return
  }
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    loadClienteWithRecovery(session.user.id).then((cliente) => {
      useAuth.setState({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
      })
    })
  }
})
```

- [ ] **Step 2:** Type-check

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 3:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add src/store/useAuth.ts
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(front): useAuth + signUp/verifyOtp/Google/passkey + recovery"
```

---

## Task 9: Crear page `Signup.tsx` (wizard)

**Files:**
- Crear: `src/pages/Signup.tsx`

- [ ] **Step 1:** Crear el archivo

Crear `src/pages/Signup.tsx`:
```tsx
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { onboardingService } from '../services/onboardingService'
import { passkeyService } from '../services/passkeyService'

type Step =
  | { kind: 'choose-method' }
  | { kind: 'email-password-form' }
  | { kind: 'verify-otp'; email: string }
  | { kind: 'completing-onboarding' }
  | { kind: 'passkey-prompt' }
  | { kind: 'done' }

export default function Signup() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const { signUpWithEmail, verifyEmailOtp, signInWithGoogle, user } = useAuth()
  const [step, setStep] = useState<Step>({ kind: 'choose-method' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeySupported, setPasskeySupported] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) setPasskeySupported(true)
  }, [])

  // Si volvemos de Google OAuth con ?step=onboarding, saltar a completing
  useEffect(() => {
    if (searchParams.get('step') === 'onboarding' && user) {
      setStep({ kind: 'completing-onboarding' })
    }
  }, [searchParams, user])

  // Trigger onboarding-complete cuando entramos a ese step
  useEffect(() => {
    if (step.kind === 'completing-onboarding') {
      ;(async () => {
        try {
          await onboardingService.completeOnboarding()
          if (typeof window !== 'undefined') window.sessionStorage?.removeItem('onboarding-pending')
          setStep({ kind: 'passkey-prompt' })
        } catch (err: any) {
          setError(err.message ?? 'Error completando onboarding')
        }
      })()
    }
  }, [step.kind])

  // Cuando llegamos a 'done', redirigir
  useEffect(() => {
    if (step.kind === 'done') nav('/', { replace: true })
  }, [step.kind, nav])

  const handleGoogle = async () => {
    setError(null); setLoading(true)
    try { await signInWithGoogle() } catch (err: any) {
      setError(err.message ?? 'Error con Google')
      setLoading(false)
    }
    // sigue en redirect
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      await signUpWithEmail(email, password)
      setStep({ kind: 'verify-otp', email })
    } catch (err: any) {
      setError(err.message ?? 'Error creando cuenta')
    } finally { setLoading(false) }
  }

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step.kind !== 'verify-otp') return
    setError(null); setLoading(true)
    try {
      await verifyEmailOtp(step.email, otpCode)
      setStep({ kind: 'passkey-prompt' })
    } catch (err: any) {
      setError(err.message ?? 'Codigo invalido')
    } finally { setLoading(false) }
  }

  const handleResendOtp = async () => {
    if (step.kind !== 'verify-otp') return
    setError(null); setLoading(true)
    try {
      await onboardingService.resendEmailOtp(step.email)
      setError('Codigo reenviado, revisa tu mail')
    } catch (err: any) {
      setError(err.message ?? 'Error reenviando codigo')
    } finally { setLoading(false) }
  }

  const handleActivatePasskey = async () => {
    setError(null); setLoading(true)
    try {
      await passkeyService.registerCurrentDevice()
      setStep({ kind: 'done' })
    } catch (err: any) {
      setError(err.message ?? 'No se pudo activar la passkey')
    } finally { setLoading(false) }
  }

  const handleSkipPasskey = () => setStep({ kind: 'done' })

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-brand-600">SecurePayNet</div>
          <div className="text-sm text-slate-500 mt-1">Crear cuenta nueva</div>
        </div>

        {step.kind === 'choose-method' && (
          <div className="space-y-3">
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Conectando…' : 'Continuar con Google'}
            </button>
            <div className="my-4 flex items-center gap-2 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200" />
              <span>o</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <button
              onClick={() => setStep({ kind: 'email-password-form' })}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg"
            >
              Email y contrasena
            </button>
          </div>
        )}

        {step.kind === 'email-password-form' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="tu@email.com" autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contrasena</label>
              <input
                type="password" required value={password} minLength={6}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="al menos 6 caracteres" autoComplete="new-password"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Creando…' : 'Crear cuenta'}
            </button>
            <button type="button" onClick={() => setStep({ kind: 'choose-method' })}
              className="w-full text-xs text-slate-500 hover:underline">
              Volver
            </button>
          </form>
        )}

        {step.kind === 'verify-otp' && (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div className="text-sm text-slate-700">
              Te enviamos un codigo a <strong>{step.email}</strong>. Revisa tu inbox (y spam).
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Codigo de 6 digitos</label>
              <input
                type="text" required value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-center text-lg tracking-widest focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="123456" inputMode="numeric" maxLength={6}
              />
            </div>
            <button
              type="submit" disabled={loading || otpCode.length !== 6}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Verificar'}
            </button>
            <button type="button" onClick={handleResendOtp} disabled={loading}
              className="w-full text-xs text-brand-600 hover:underline">
              Reenviar codigo
            </button>
          </form>
        )}

        {step.kind === 'completing-onboarding' && (
          <div className="text-center text-sm text-slate-600 py-8">
            Configurando tu cuenta…
          </div>
        )}

        {step.kind === 'passkey-prompt' && (
          <div className="space-y-4">
            <div className="text-sm text-slate-700">
              <div className="font-semibold mb-1">Activar acceso rapido</div>
              <div>La proxima vez ingresa con tu huella o cara, sin contrasena.</div>
            </div>
            {passkeySupported ? (
              <button
                onClick={handleActivatePasskey} disabled={loading}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
              >
                {loading ? 'Activando…' : 'Activar passkey'}
              </button>
            ) : (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
                Tu dispositivo no soporta passkeys. Podes ingresar con email y contrasena.
              </div>
            )}
            <button onClick={handleSkipPasskey}
              className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg">
              Mas tarde
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </div>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-xs text-slate-500 hover:underline">
            Ya tengo cuenta — Ingresar
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** Type-check

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 3:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add src/pages/Signup.tsx
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(signup): wizard 3 pasos (Google/email-OTP/passkey)"
```

---

## Task 10: Modificar `Login.tsx` con CTA + passkey real

**Files:**
- Modificar: `src/pages/Login.tsx`

- [ ] **Step 1:** Sobreescribir el archivo entero

Sobreescribir `src/pages/Login.tsx` con:
```tsx
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'

export default function Login() {
  const nav = useNavigate()
  const { user, signIn, hydrating } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeySupported, setPasskeySupported] = useState(false)

  useEffect(() => {
    if (user && !hydrating) nav('/', { replace: true })
  }, [user, hydrating, nav])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setPasskeySupported(true)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await signIn(email, password)
    setLoading(false)
    if (res.error) setError(res.error)
    else nav('/', { replace: true })
  }

  const handlePasskey = async () => {
    if (!email.trim()) {
      setError('Tipea tu email primero')
      return
    }
    setError(null); setLoading(true)
    try {
      await useAuth.getState().signInWithPasskey(email.trim())
      nav('/', { replace: true })
    } catch (err: any) {
      const msg = err.message === 'CLONED_CREDENTIAL'
        ? 'Passkey invalida. Contactá soporte.'
        : (err.message ?? 'No se pudo ingresar con passkey')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-brand-600">SecurePayNet</div>
          <div className="text-sm text-slate-500 mt-1">Tu billetera virtual</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              placeholder="tu@email.com" autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contrasena</label>
            <input
              type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              placeholder="contrasena" autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        {passkeySupported && (
          <>
            <div className="my-4 flex items-center gap-2 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200" />
              <span>o</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <button
              onClick={handlePasskey} disabled={loading}
              className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Ingresar con passkey'}
            </button>
          </>
        )}

        <Link to="/signup" className="block text-center text-xs text-brand-600 hover:underline mt-4">
          No tengo cuenta — Crear cuenta
        </Link>

        <div className="mt-6 text-center text-xs text-slate-400">
          SecurePayNet S.A. - PSPCP registrado en BCRA
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** Type-check

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 3:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add src/pages/Login.tsx
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(login): CTA crear cuenta + passkey-login real"
```

---

## Task 11: Agregar route en `App.tsx`

**Files:**
- Modificar: `src/App.tsx`

- [ ] **Step 1:** Agregar import y route

Editar `src/App.tsx`. Después del último import de page (después de `import Contactos from './pages/Contactos'`), agregar:
```tsx
import Signup from './pages/Signup'
```

Después del `<Route path="/login" element={<Login />} />`, agregar (antes del `<Route element={<Protected>...`):
```tsx
      <Route path="/signup" element={<Signup />} />
```

- [ ] **Step 2:** Type-check + build

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx tsc --noEmit && npm run build
```
Expected: tsc exit 0, build con `built in N.NNs` y dist generado.

- [ ] **Step 3:** Commit

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git add src/App.tsx
git -c user.name=cv-sketch -c user.email=cv@ibba.group commit -m "feat(app): route /signup"
```

---

## Task 12: Verificación final, push y PR

**Files:**
- (todos los anteriores)

- [ ] **Step 1:** Verificación completa

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
npx tsc --noEmit && npm run build && deno test --allow-all supabase/functions/_shared/cuitMock_test.ts
```
Expected:
- tsc: exit 0
- build: `built in N.NNs`
- deno tests: 5 passed

- [ ] **Step 2:** Confirmar Edge Functions deployadas

```bash
TOKEN=$(cat ~/.supabase/access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/functions" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); names=[f['slug'] for f in data]; print('Deployed:', sorted(n for n in names if n in ['onboarding-complete','passkey-login-begin','passkey-login-finish']))"
```
Expected: `Deployed: ['onboarding-complete', 'passkey-login-begin', 'passkey-login-finish']`.

- [ ] **Step 3:** Push branch

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
git push -u origin feat/onboarding-rapido
```
Expected: branch creada en origin.

- [ ] **Step 4:** Abrir PR

```bash
cd /home/tron/securepaynet-app/.worktrees/onboarding-rapido
gh pr create --base main --head feat/onboarding-rapido \
  --title "feat(onboarding): alta rapida sin KYC + passkey-login from cold" \
  --body "$(cat <<'EOF'
## Resumen

Habilita alta de cuenta para testers (Google + email/password con OTP, $5.000 mock balance, registro opcional de passkey) y login passwordless con passkey desde frio.

## Spec

`docs/superpowers/specs/2026-04-27-onboarding-rapido-design.md`

## Cambios

**Schema:**
- Migracion: UNIQUE constraint en `clientes(auth_user_id)` para idempotencia del onboarding-complete

**Edge Functions nuevas (3):**
- `onboarding-complete` — JWT-protected, crea cliente+wallet con stubs idempotentes
- `passkey-login-begin` — anonima, devuelve options de WebAuthn por email
- `passkey-login-finish` — anonima, verifica assertion + emite `hashed_token` magiclink

**Front:**
- Nueva page `/signup` con wizard de 3 pasos (Google/email-OTP/passkey)
- `Login.tsx`: CTA "Crear cuenta" + boton passkey ahora cableado al flow real (antes era placeholder)
- `useAuth.ts`: agrega `signUpWithEmail`, `verifyEmailOtp`, `signInWithGoogle`, `signInWithPasskey`, recovery via sessionStorage flag
- `passkeyService.ts`: agrega `loginBegin(email)` y `loginFinish(email, credential)`
- Nuevo `onboardingService.ts`

## Configuracion manual requerida (post-merge)

1. **Google OAuth:** crear OAuth client en Google Cloud Console, habilitar provider en Supabase Dashboard, agregar redirect URLs (`<site>/signup`, `http://localhost:5173/signup`). Sin esto, el boton Google falla.
2. **Email confirmation:** verificar que Authentication → Settings → "Confirm email" este ON.

## Test plan

- [ ] **Email signup:** abrir `/signup` incognito, elegir email+password, ingresar mail nuevo, recibir OTP, pegar codigo, llegar a Dashboard con $5.000
- [ ] **Activar passkey en Step 3:** completar ceremonia biometria, llegar a Dashboard
- [ ] **Sign out + passkey-login:** en `/login`, tipear email, click "Ingresar con passkey", aprobar biometria, entrar sin pedir password
- [ ] **Skip passkey:** signup, click "Mas tarde" en Step 3, llegar a Dashboard
- [ ] **Reenviar OTP:** en Step 2 click "Reenviar codigo", verificar segundo mail
- [ ] **Google signup:** elegir Google → completar OAuth → llegar a Dashboard con $5.000 (REQUIERE config previa)
- [ ] **Idempotencia:** cerrar browser despues de OTP, abrir `/signup` de nuevo con mismo email, verificar que no rompe (cliente ya creado o se crea ahora)

## Spec & plan

- Spec: `docs/superpowers/specs/2026-04-27-onboarding-rapido-design.md`
- Plan: `docs/superpowers/plans/2026-04-27-onboarding-rapido.md`
EOF
)"
```
Expected: PR URL en stdout.

- [ ] **Step 5:** Imprimir PR URL

Anotar el PR URL para reportar al orquestador.
