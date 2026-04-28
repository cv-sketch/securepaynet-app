# Sprint 1 — Session Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar timeout obligatorio de sesión (idle + absoluto) con invalidación server-side, modal de aviso con cuenta regresiva, mensajes post-expiración en login, y logs de auditoría. Cubre Feature 1 completo de la spec SecurePayNet v1.0 (sección 2).

**Architecture:** Supabase JWT sigue manejando autenticación. Encima agregamos una tabla `user_sessions` que es la fuente de verdad para validez de sesión. Una Edge Function `session-heartbeat` valida la sesión, refresca `last_activity_at` y devuelve segundos restantes; el cliente la llama cada 30s mientras el tab está activo. Cuando expira (idle o absoluto) la función marca la sesión como revocada, llama a `auth.admin.signOut` para invalidar el refresh_token, y registra en `session_audit_log`. El cliente muestra modal a T-60s y redirige a `/login?expired=<reason>`.

**Tech Stack:** Deno (Edge Functions), Supabase Auth Admin API, Postgres (`user_sessions`, `session_audit_log`), React 18, Zustand.

**Spec de referencia:** `SecurePayNet — Spec Funcional v1.0`, sección 2 (Feature 1).

**Out of scope (Sprint 1):**
- Roles privilegiados con timeouts más estrictos (sin sistema de roles aún — el helper acepta el parámetro pero defaultea a `standard`).
- Reglas adicionales para `password_changed` y `forced_admin` (la spec las menciona pero requieren admin panel — el `revoke_reason` enum las contempla para compatibilidad futura).
- Aplicar validación de sesión en RPCs RLS-gated (las contactos RPCs ya validan gate_token; no necesitan re-check de sesión en Sprint 1, queda para Sprint 2).

---

## File Structure

| Path | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260428_user_sessions.sql` | Crear + aplicar | Tablas `user_sessions` + `session_audit_log` con RLS estricta |
| `supabase/functions/_shared/sessionConfig.ts` | Crear | Lectura de env vars + resolver `{idle_seconds, absolute_seconds}` por rol |
| `supabase/functions/_shared/sessionConfig_test.ts` | Crear | Deno tests del resolver |
| `supabase/functions/session-create/index.ts` | Crear | POST: crea fila en `user_sessions`, devuelve `session_id` |
| `supabase/functions/session-heartbeat/index.ts` | Crear | POST: valida + refresca o expira sesión, devuelve segundos restantes |
| `supabase/functions/session-revoke/index.ts` | Crear | POST: revoca sesión + invalida refresh_token de Supabase |
| `src/lib/sessionApi.ts` | Crear | Wrappers fetch para las 3 Edge Functions |
| `src/hooks/useSessionTimeout.ts` | Crear | Hook: polling de heartbeat, expone `idleRemaining`, `absoluteRemaining`, `expired` |
| `src/components/SessionExpiryModal.tsx` | Crear | Modal con cuenta regresiva + botón "Seguir conectado" |
| `src/store/useAuth.ts` | Modificar | Agregar `sessionId`; llamar `session-create` en signIn, `session-revoke` en signOut |
| `src/pages/Login.tsx` | Modificar | Leer `?expired=idle\|absolute` y mostrar mensaje |
| `src/App.tsx` | Modificar | Montar `SessionExpiryModal` dentro de `<Protected>` |

**Frecuencias / parámetros (env vars en Edge Functions, defaults en código):**
- `SESSION_IDLE_TIMEOUT_SECONDS` → 900 (15 min)
- `SESSION_ABSOLUTE_LIFETIME_SECONDS` → 28800 (8 h)
- `SESSION_PRIVILEGED_IDLE_SECONDS` → 600 (10 min) — sin uso aún
- `SESSION_PRIVILEGED_ABSOLUTE_SECONDS` → 14400 (4 h) — sin uso aún
- Heartbeat client polling: 30 s
- Modal warning: T - 60 s

---

## Task 1: Migration — `user_sessions` y `session_audit_log`

**Files:**
- Create: `supabase/migrations/20260428_user_sessions.sql`

- [ ] **Step 1: Crear migration con tablas + RLS**

```sql
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
```

- [ ] **Step 2: Aplicar la migration**

```bash
cd /home/tron/securepaynet-app
supabase db push
```

Expected: dos tablas y dos índices creados. Verificar:
```bash
supabase db remote query --query "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_sessions','session_audit_log')"
```
Expected output: 2 filas.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428_user_sessions.sql
git commit -m "feat(sessions): user_sessions + session_audit_log tables with RLS lockdown"
```

---

## Task 2: `sessionConfig.ts` — resolver de timeouts por rol

**Files:**
- Create: `supabase/functions/_shared/sessionConfig.ts`
- Test: `supabase/functions/_shared/sessionConfig_test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// supabase/functions/_shared/sessionConfig_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { resolveSessionConfig } from './sessionConfig.ts'

Deno.test('resolveSessionConfig: rol standard usa defaults', () => {
  const env = {
    SESSION_IDLE_TIMEOUT_SECONDS: '900',
    SESSION_ABSOLUTE_LIFETIME_SECONDS: '28800',
    SESSION_PRIVILEGED_IDLE_SECONDS: '600',
    SESSION_PRIVILEGED_ABSOLUTE_SECONDS: '14400',
  }
  const cfg = resolveSessionConfig('standard', env)
  assertEquals(cfg.idleSeconds, 900)
  assertEquals(cfg.absoluteSeconds, 28800)
})

Deno.test('resolveSessionConfig: roles admin/compliance/soporte usan privileged', () => {
  const env = {
    SESSION_IDLE_TIMEOUT_SECONDS: '900',
    SESSION_ABSOLUTE_LIFETIME_SECONDS: '28800',
    SESSION_PRIVILEGED_IDLE_SECONDS: '600',
    SESSION_PRIVILEGED_ABSOLUTE_SECONDS: '14400',
  }
  for (const role of ['admin', 'compliance', 'soporte']) {
    const cfg = resolveSessionConfig(role, env)
    assertEquals(cfg.idleSeconds, 600, `idle for ${role}`)
    assertEquals(cfg.absoluteSeconds, 14400, `absolute for ${role}`)
  }
})

Deno.test('resolveSessionConfig: rol desconocido cae a standard', () => {
  const env = {
    SESSION_IDLE_TIMEOUT_SECONDS: '900',
    SESSION_ABSOLUTE_LIFETIME_SECONDS: '28800',
    SESSION_PRIVILEGED_IDLE_SECONDS: '600',
    SESSION_PRIVILEGED_ABSOLUTE_SECONDS: '14400',
  }
  const cfg = resolveSessionConfig('emprendedor', env)
  assertEquals(cfg.idleSeconds, 900)
  assertEquals(cfg.absoluteSeconds, 28800)
})

Deno.test('resolveSessionConfig: env vars ausentes usan defaults hardcoded', () => {
  const cfg = resolveSessionConfig('standard', {})
  assertEquals(cfg.idleSeconds, 900)
  assertEquals(cfg.absoluteSeconds, 28800)
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd /home/tron/securepaynet-app
deno test supabase/functions/_shared/sessionConfig_test.ts --allow-env
```

Expected: FAIL con `Module not found: ./sessionConfig.ts` o similar.

- [ ] **Step 3: Implementar el módulo**

```typescript
// supabase/functions/_shared/sessionConfig.ts
// Resuelve duración de idle / absolute timeout en base al rol del usuario.

export type SessionConfig = {
  idleSeconds: number
  absoluteSeconds: number
}

const PRIVILEGED_ROLES = new Set(['admin', 'compliance', 'soporte'])

const DEFAULTS = {
  standardIdle: 900,
  standardAbsolute: 28800,
  privilegedIdle: 600,
  privilegedAbsolute: 14400,
}

function readInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function resolveSessionConfig(role: string, env: Record<string, string | undefined>): SessionConfig {
  const isPrivileged = PRIVILEGED_ROLES.has(role)
  if (isPrivileged) {
    return {
      idleSeconds: readInt(env, 'SESSION_PRIVILEGED_IDLE_SECONDS', DEFAULTS.privilegedIdle),
      absoluteSeconds: readInt(env, 'SESSION_PRIVILEGED_ABSOLUTE_SECONDS', DEFAULTS.privilegedAbsolute),
    }
  }
  return {
    idleSeconds: readInt(env, 'SESSION_IDLE_TIMEOUT_SECONDS', DEFAULTS.standardIdle),
    absoluteSeconds: readInt(env, 'SESSION_ABSOLUTE_LIFETIME_SECONDS', DEFAULTS.standardAbsolute),
  }
}
```

- [ ] **Step 4: Correr el test, debe pasar**

```bash
deno test supabase/functions/_shared/sessionConfig_test.ts --allow-env
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/sessionConfig.ts supabase/functions/_shared/sessionConfig_test.ts
git commit -m "feat(sessions): sessionConfig resolver with privileged-role overrides"
```

---

## Task 3: Edge Function `session-create`

**Files:**
- Create: `supabase/functions/session-create/index.ts`

- [ ] **Step 1: Escribir la función**

```typescript
// supabase/functions/session-create/index.ts
// POST con Bearer JWT del usuario. Crea fila en user_sessions y devuelve session_id.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveSessionConfig } from '../_shared/sessionConfig.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const userId = u.user.id

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: cli } = await admin
    .from('clientes')
    .select('tipo')
    .eq('auth_user_id', userId)
    .maybeSingle()
  const role = cli?.tipo === 'admin' || cli?.tipo === 'compliance' || cli?.tipo === 'soporte'
    ? cli.tipo
    : 'standard'

  const cfg = resolveSessionConfig(role, Deno.env.toObject())

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  const absoluteExpiresAt = new Date(Date.now() + cfg.absoluteSeconds * 1000).toISOString()

  const { data: session, error: insErr } = await admin
    .from('user_sessions')
    .insert({
      user_id: userId,
      absolute_expires_at: absoluteExpiresAt,
      idle_timeout_seconds: cfg.idleSeconds,
      role,
      ip,
      user_agent: userAgent,
    })
    .select('id')
    .single()
  if (insErr || !session) {
    console.error('[session-create] insert error:', insErr)
    return jsonErr(500, 'session create failed')
  }

  await admin.from('session_audit_log').insert({
    session_id: session.id,
    user_id: userId,
    event: 'created',
    ip,
    user_agent: userAgent,
  })

  return new Response(
    JSON.stringify({
      session_id: session.id,
      idle_remaining_seconds: cfg.idleSeconds,
      absolute_remaining_seconds: cfg.absoluteSeconds,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: Deploy**

```bash
cd /home/tron/securepaynet-app
supabase functions deploy session-create
```

- [ ] **Step 3: Smoke test contra dev environment**

Loguearse en la app dev, copiar el `access_token` desde devtools (Application → Local Storage → `sb-…-auth-token`), y probar:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/session-create" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

Expected: `{"session_id":"<uuid>","idle_remaining_seconds":900,"absolute_remaining_seconds":28800}`. Verificar fila en `user_sessions` y entrada `created` en `session_audit_log`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/session-create/index.ts
git commit -m "feat(sessions): session-create Edge Function"
```

---

## Task 4: Edge Function `session-heartbeat`

**Files:**
- Create: `supabase/functions/session-heartbeat/index.ts`

- [ ] **Step 1: Escribir la función**

```typescript
// supabase/functions/session-heartbeat/index.ts
// POST con Bearer JWT + body { session_id }.
// Si la sesión está vigente: refresca last_activity_at, devuelve segundos restantes.
// Si expiró: la marca revocada con reason='idle'|'absolute', llama auth.admin.signOut, devuelve {expired}.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  let sessionId: string
  try {
    const body = await req.json()
    sessionId = String(body?.session_id ?? '')
  } catch {
    return jsonErr(400, 'invalid body')
  }
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return jsonErr(400, 'invalid session_id')

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const userId = u.user.id
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: session, error: selErr } = await admin
    .from('user_sessions')
    .select('id, user_id, last_activity_at, absolute_expires_at, idle_timeout_seconds, revoked_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (selErr) return jsonErr(500, 'session lookup failed')
  if (!session || session.user_id !== userId) return jsonErr(404, 'session not found')
  if (session.revoked_at) return jsonExpired(401, 'revoked')

  const now = Date.now()
  const lastActivity = new Date(session.last_activity_at).getTime()
  const absoluteExpires = new Date(session.absolute_expires_at).getTime()
  const idleDeadline = lastActivity + session.idle_timeout_seconds * 1000

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  if (now >= absoluteExpires) {
    await expire(admin, session.id, userId, 'absolute', ip, userAgent, authHeader)
    return jsonExpired(401, 'absolute')
  }
  if (now >= idleDeadline) {
    await expire(admin, session.id, userId, 'idle', ip, userAgent, authHeader)
    return jsonExpired(401, 'idle')
  }

  // Sesión vigente: refrescar last_activity_at (sliding session).
  await admin.from('user_sessions').update({ last_activity_at: new Date(now).toISOString() }).eq('id', session.id)
  await admin.from('session_audit_log').insert({
    session_id: session.id,
    user_id: userId,
    event: 'heartbeat',
    ip,
    user_agent: userAgent,
  })

  // Después del refresh el contador idle reinicia a su valor configurado (sliding).
  const idleRemainingAfterRefresh = session.idle_timeout_seconds
  const absoluteRemaining = Math.floor((absoluteExpires - now) / 1000)

  return new Response(
    JSON.stringify({
      ok: true,
      idle_remaining_seconds: idleRemainingAfterRefresh,
      absolute_remaining_seconds: absoluteRemaining,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

async function expire(
  admin: ReturnType<typeof createClient>,
  sessionId: string,
  userId: string,
  reason: 'idle' | 'absolute',
  ip: string | null,
  userAgent: string | null,
  authHeader: string,
) {
  await admin
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq('id', sessionId)
  await admin.from('session_audit_log').insert({
    session_id: sessionId,
    user_id: userId,
    event: reason === 'idle' ? 'expired_idle' : 'expired_absolute',
    ip,
    user_agent: userAgent,
  })
  // Invalida el refresh_token de Supabase para que la próxima refresh falle.
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  try {
    await admin.auth.admin.signOut(jwt, 'global')
  } catch (e) {
    console.error('[session-heartbeat] signOut error:', e)
  }
}

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonExpired(status: number, reason: string): Response {
  return new Response(JSON.stringify({ ok: false, expired: reason }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy session-heartbeat
```

- [ ] **Step 3: Smoke test — sesión vigente**

```bash
SESSION_ID=<id_de_session-create>
curl -s -X POST "$SUPABASE_URL/functions/v1/session-heartbeat" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\"}"
```

Expected: `{"ok":true,"idle_remaining_seconds":900,"absolute_remaining_seconds":<≈28800>}`. Verificar entrada `heartbeat` en audit log.

- [ ] **Step 4: Smoke test — forzar expiración idle**

```bash
# Hackear last_activity_at hacia el pasado (>15 min)
supabase db remote query --query "UPDATE user_sessions SET last_activity_at = now() - interval '20 minutes' WHERE id = '$SESSION_ID'"

curl -s -X POST "$SUPABASE_URL/functions/v1/session-heartbeat" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\"}"
```

Expected: `{"ok":false,"expired":"idle"}` con status 401. Verificar `revoked_at` y `revoke_reason='idle'` en `user_sessions`, y entrada `expired_idle` en audit log.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/session-heartbeat/index.ts
git commit -m "feat(sessions): session-heartbeat with idle/absolute expiry + audit log"
```

---

## Task 5: Edge Function `session-revoke`

**Files:**
- Create: `supabase/functions/session-revoke/index.ts`

- [ ] **Step 1: Escribir la función**

```typescript
// supabase/functions/session-revoke/index.ts
// POST con Bearer JWT + body { session_id, reason? }.
// Marca la sesión revocada (default reason='user'), invalida refresh_token,
// registra evento en audit log.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  let sessionId: string
  let reason: string
  try {
    const body = await req.json()
    sessionId = String(body?.session_id ?? '')
    reason = String(body?.reason ?? 'user')
  } catch {
    return jsonErr(400, 'invalid body')
  }
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return jsonErr(400, 'invalid session_id')
  if (!['user', 'forced_admin', 'password_changed'].includes(reason)) {
    return jsonErr(400, 'invalid reason')
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const userId = u.user.id
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  const { data: session } = await admin
    .from('user_sessions')
    .select('id, user_id, revoked_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session || session.user_id !== userId) return jsonErr(404, 'session not found')

  if (!session.revoked_at) {
    await admin
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
      .eq('id', session.id)
  }

  await admin.from('session_audit_log').insert({
    session_id: session.id,
    user_id: userId,
    event: reason === 'user' ? 'user_logout' : reason === 'forced_admin' ? 'forced_admin' : 'password_changed',
    ip,
    user_agent: userAgent,
  })

  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  try {
    await admin.auth.admin.signOut(jwt, 'global')
  } catch (e) {
    console.error('[session-revoke] signOut error:', e)
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy session-revoke
```

- [ ] **Step 3: Smoke test**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/session-revoke" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\"}"
```

Expected: `{"ok":true}`. Verificar `revoked_at`, `revoke_reason='user'` y evento `user_logout` en audit log. Un siguiente refresh del JWT debe fallar.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/session-revoke/index.ts
git commit -m "feat(sessions): session-revoke for explicit logout"
```

---

## Task 6: Cliente — `src/lib/sessionApi.ts`

**Files:**
- Create: `src/lib/sessionApi.ts`

- [ ] **Step 1: Implementar wrappers**

```typescript
// src/lib/sessionApi.ts
import { supabase } from './supabase'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('no_jwt')
  return fetch(`${FN_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export type CreateSessionResult = {
  session_id: string
  idle_remaining_seconds: number
  absolute_remaining_seconds: number
}

export async function createSession(): Promise<CreateSessionResult> {
  const r = await authedFetch('/session-create', {})
  if (!r.ok) throw new Error(`session-create failed: ${r.status}`)
  return await r.json()
}

export type HeartbeatResult =
  | { ok: true; idle_remaining_seconds: number; absolute_remaining_seconds: number }
  | { ok: false; expired: 'idle' | 'absolute' | 'revoked' }

export async function sessionHeartbeat(sessionId: string): Promise<HeartbeatResult> {
  const r = await authedFetch('/session-heartbeat', { session_id: sessionId })
  if (r.status === 401) {
    const body = await r.json().catch(() => ({}))
    if (body?.expired) return { ok: false, expired: body.expired }
  }
  if (!r.ok) throw new Error(`heartbeat failed: ${r.status}`)
  return await r.json()
}

export async function revokeSession(sessionId: string, reason: 'user' = 'user'): Promise<void> {
  const r = await authedFetch('/session-revoke', { session_id: sessionId, reason })
  if (!r.ok) console.warn('[revokeSession] non-200:', r.status)
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
cd /home/tron/securepaynet-app
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sessionApi.ts
git commit -m "feat(sessions): client wrappers for session-create/heartbeat/revoke"
```

---

## Task 7: Hook `useSessionTimeout`

**Files:**
- Create: `src/hooks/useSessionTimeout.ts`

- [ ] **Step 1: Implementar el hook**

```typescript
// src/hooks/useSessionTimeout.ts
import { useEffect, useRef, useState } from 'react'
import { sessionHeartbeat } from '../lib/sessionApi'

const HEARTBEAT_INTERVAL_MS = 30_000 // 30s
const WARNING_THRESHOLD_S = 60       // mostrar modal a T-60s

export type SessionTimeoutState = {
  idleRemaining: number | null
  absoluteRemaining: number | null
  showWarning: boolean
  expiredReason: 'idle' | 'absolute' | 'revoked' | null
  refresh: () => Promise<void>
}

export function useSessionTimeout(sessionId: string | null): SessionTimeoutState {
  const [idleRemaining, setIdleRemaining] = useState<number | null>(null)
  const [absoluteRemaining, setAbsoluteRemaining] = useState<number | null>(null)
  const [expiredReason, setExpiredReason] = useState<'idle' | 'absolute' | 'revoked' | null>(null)
  const tickRef = useRef<number | null>(null)

  const ping = async () => {
    if (!sessionId) return
    try {
      const r = await sessionHeartbeat(sessionId)
      if (!r.ok) {
        setExpiredReason(r.expired)
        return
      }
      setIdleRemaining(r.idle_remaining_seconds)
      setAbsoluteRemaining(r.absolute_remaining_seconds)
    } catch (e) {
      console.warn('[useSessionTimeout] heartbeat error:', e)
    }
  }

  useEffect(() => {
    if (!sessionId) {
      setIdleRemaining(null)
      setAbsoluteRemaining(null)
      setExpiredReason(null)
      return
    }
    void ping()
    const id = window.setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Decremento local cada segundo (UX fluida del countdown).
  useEffect(() => {
    if (idleRemaining === null || expiredReason !== null) return
    if (tickRef.current) window.clearInterval(tickRef.current)
    tickRef.current = window.setInterval(() => {
      setIdleRemaining((v) => (v !== null && v > 0 ? v - 1 : v))
      setAbsoluteRemaining((v) => (v !== null && v > 0 ? v - 1 : v))
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [idleRemaining === null, expiredReason])

  const showWarning =
    idleRemaining !== null && idleRemaining <= WARNING_THRESHOLD_S && expiredReason === null

  return {
    idleRemaining,
    absoluteRemaining,
    showWarning,
    expiredReason,
    refresh: ping,
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSessionTimeout.ts
git commit -m "feat(sessions): useSessionTimeout hook with 30s heartbeat + 60s warning"
```

---

## Task 8: Componente `SessionExpiryModal`

**Files:**
- Create: `src/components/SessionExpiryModal.tsx`

- [ ] **Step 1: Implementar el modal**

```tsx
// src/components/SessionExpiryModal.tsx
import { useEffect, useState } from 'react'

type Props = {
  open: boolean
  remainingSeconds: number | null
  onContinue: () => Promise<void> | void
  onLogout: () => Promise<void> | void
}

export default function SessionExpiryModal({ open, remainingSeconds, onContinue, onLogout }: Props) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  if (!open) return null

  const handleContinue = async () => {
    setBusy(true)
    try {
      await onContinue()
    } finally {
      setBusy(false)
    }
  }

  const seconds = Math.max(0, remainingSeconds ?? 0)

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-5">
        <h2 className="text-base font-bold text-slate-800 mb-2">Tu sesión está por expirar</h2>
        <p className="text-sm text-slate-600 mb-4">
          Tu sesión expirará en <strong className="text-red-600">{seconds} segundos</strong> por inactividad.
          ¿Querés seguir conectado?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleContinue}
            disabled={busy}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
          >
            {busy ? 'Conectando...' : 'Seguir conectado'}
          </button>
          <button
            onClick={onLogout}
            className="w-full text-sm text-slate-600 font-medium py-2"
          >
            Cerrar sesión ahora
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionExpiryModal.tsx
git commit -m "feat(sessions): SessionExpiryModal countdown UI"
```

---

## Task 9: Wire `useAuth` al ciclo de vida de sesión

**Files:**
- Modify: `src/store/useAuth.ts`

- [ ] **Step 1: Reemplazar el contenido completo del store**

Reemplazar `src/store/useAuth.ts` con:

```typescript
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { onboardingService } from '../services/onboardingService'
import { passkeyService } from '../services/passkeyService'
import { authenticateCredential } from '../lib/webauthn'
import { createSession, revokeSession } from '../lib/sessionApi'

const SESSION_ID_KEY = 'spn.session_id'

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
  sessionId: string | null
  hydrating: boolean
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: (reason?: 'user' | 'idle' | 'absolute') => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  verifyEmailOtp: (email: string, code: string) => Promise<void>
  signInWithGoogleLogin: () => Promise<void>
  signInWithGoogleSignup: () => Promise<void>
  signInWithPasskey: (email: string) => Promise<void>
  ensureSession: () => Promise<void>
}

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
    if (!cli) return null
    const { data: wal } = await supabase
      .from('wallets')
      .select('cvu, alias, saldo, moneda')
      .eq('cliente_id', cli.id)
      .maybeSingle()
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

export const useAuth = create<State>((set, get) => ({
  user: null,
  cliente: null,
  sessionId: localStorage.getItem(SESSION_ID_KEY),
  hydrating: true,

  hydrate: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        localStorage.removeItem(SESSION_ID_KEY)
        set({ user: null, cliente: null, sessionId: null, hydrating: false })
        return
      }
      const cliente = await loadCliente(session.user.id)
      set({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
        hydrating: false,
      })
      if (!localStorage.getItem(SESSION_ID_KEY)) {
        await get().ensureSession()
      }
    } catch (err) {
      console.error('[hydrate] error:', err)
      set({ hydrating: false })
    }
  },

  ensureSession: async () => {
    if (get().sessionId) return
    try {
      const { session_id } = await createSession()
      localStorage.setItem(SESSION_ID_KEY, session_id)
      set({ sessionId: session_id })
    } catch (e) {
      console.error('[ensureSession] failed:', e)
    }
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    if (data.user) {
      const cliente = await loadCliente(data.user.id)
      set({
        user: { id: data.user.id, email: data.user.email ?? '' },
        cliente,
      })
      await get().ensureSession()
    }
    return { error: null }
  },

  signOut: async (reason = 'user') => {
    const sid = get().sessionId
    if (sid && reason === 'user') {
      try { await revokeSession(sid, 'user') } catch (e) { console.warn(e) }
    }
    localStorage.removeItem(SESSION_ID_KEY)
    await supabase.auth.signOut()
    set({ user: null, cliente: null, sessionId: null })
  },

  signUpWithEmail: async (email, password) => {
    await onboardingService.signUpWithEmail(email, password)
  },

  verifyEmailOtp: async (email, code) => {
    await onboardingService.verifyEmailOtp(email, code)
  },

  signInWithGoogleLogin: async () => {
    const redirectTo = `${window.location.origin}/login`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  signInWithGoogleSignup: async () => {
    const redirectTo = `${window.location.origin}/signup?step=oauth-return`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  signInWithPasskey: async (email) => {
    const { options } = await passkeyService.loginBegin(email)
    const credential = await authenticateCredential(options)
    const { hashedToken } = await passkeyService.loginFinish(email, credential)
    const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
    if (error) throw error
    // ensureSession se llamará desde el listener onAuthStateChange.
  },
}))

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    localStorage.removeItem(SESSION_ID_KEY)
    useAuth.setState({ user: null, cliente: null, sessionId: null })
    return
  }
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    loadCliente(session.user.id).then((cliente) => {
      useAuth.setState({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
      })
      if (event === 'SIGNED_IN') void useAuth.getState().ensureSession()
    })
  }
})
```

- [ ] **Step 2: Typecheck + build**

```bash
npx tsc -b --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/store/useAuth.ts
git commit -m "feat(sessions): wire useAuth to session-create/revoke lifecycle"
```

---

## Task 10: Login `?expired` messaging

**Files:**
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Leer la implementación actual**

```bash
sed -n '1,80p' src/pages/Login.tsx
```

- [ ] **Step 2: Agregar lectura de `?expired` y banner**

En `Login.tsx`, agregar al import:

```tsx
import { useSearchParams } from 'react-router-dom'
```

Dentro del componente `Login`, antes del primer hook existente:

```tsx
const [params] = useSearchParams()
const expiredReason = params.get('expired')
const expiredMessage =
  expiredReason === 'idle'
    ? 'Tu sesión finalizó por inactividad. Iniciá sesión nuevamente.'
    : expiredReason === 'absolute'
    ? 'Tu sesión alcanzó la duración máxima permitida. Iniciá sesión nuevamente.'
    : null
```

En el JSX, dentro del card principal y arriba del input de email:

```tsx
{expiredMessage && (
  <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
    {expiredMessage}
  </div>
)}
```

> **Nota:** ajustar la posición exacta al layout actual de `Login.tsx`. El banner debe quedar dentro del card pero antes del primer input.

- [ ] **Step 3: Typecheck**

```bash
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat(sessions): banner post-expiry en login con motivo (idle|absolute)"
```

---

## Task 11: Montar `SessionExpiryModal` en `Protected`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Cambiar `Protected` para incluir el modal y manejar expiración**

En `src/App.tsx`, ajustar imports en la cabecera:

```tsx
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import SessionExpiryModal from './components/SessionExpiryModal'
import { useSessionTimeout } from './hooks/useSessionTimeout'
```

Y reemplazar la definición de `Protected`:

```tsx
function Protected({ children }: { children: JSX.Element }) {
  const { user, hydrating, sessionId, signOut } = useAuth()
  const nav = useNavigate()
  const { idleRemaining, showWarning, expiredReason, refresh } = useSessionTimeout(sessionId)

  useEffect(() => {
    if (!expiredReason) return
    void (async () => {
      await signOut(expiredReason === 'idle' ? 'idle' : 'absolute')
      nav(`/login?expired=${expiredReason}`, { replace: true })
    })()
  }, [expiredReason, signOut, nav])

  if (hydrating) return <div className="p-8 text-center text-slate-500">Cargando…</div>
  if (!user) return <Navigate to="/login" replace />

  return (
    <>
      {children}
      <SessionExpiryModal
        open={showWarning}
        remainingSeconds={idleRemaining}
        onContinue={refresh}
        onLogout={async () => {
          await signOut('user')
          nav('/login', { replace: true })
        }}
      />
    </>
  )
}
```

- [ ] **Step 2: Typecheck + build**

```bash
npx tsc -b --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(sessions): mount SessionExpiryModal + auto-redirect on expiry"
```

---

## Task 12: Smoke test E2E en dev server

**Files:** ninguno (verificación manual en navegador)

- [ ] **Step 1: Levantar dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verificar flujo idle**

1. Loguearse con un usuario test → debe aparecer fila en `user_sessions` y evento `created` en audit log.
2. En consola del navegador, observar llamadas a `/functions/v1/session-heartbeat` cada 30s con respuesta `{ok:true}`.
3. Forzar expiración idle:
   ```sql
   UPDATE user_sessions
   SET last_activity_at = now() - interval '20 minutes'
   WHERE user_id = '<test-uuid>' AND revoked_at IS NULL;
   ```
4. Esperar el siguiente heartbeat (≤30s) → la app debe redirigir a `/login?expired=idle` y mostrar el banner.

- [ ] **Step 3: Verificar flujo modal**

1. Loguearse con un usuario test.
2. Forzar `last_activity_at` a `(idle_timeout - 70s)`:
   ```sql
   UPDATE user_sessions
   SET last_activity_at = now() - interval '13 minutes 50 seconds'
   WHERE user_id = '<test-uuid>' AND revoked_at IS NULL;
   ```
3. Esperar próximo heartbeat → modal debe aparecer con countdown ≈70s.
4. Click en "Seguir conectado" → modal cierra, `last_activity_at` se actualiza a `now()`, `idle_remaining_seconds` vuelve a 900.

- [ ] **Step 4: Verificar flujo absoluto**

```sql
UPDATE user_sessions
SET absolute_expires_at = now() - interval '1 minute'
WHERE user_id = '<test-uuid>' AND revoked_at IS NULL;
```
Esperar próximo heartbeat → redirigir a `/login?expired=absolute` con el banner correcto.

- [ ] **Step 5: Verificar logout manual**

Click "Cerrar sesión" en el menú → fila marcada `revoke_reason='user'`, evento `user_logout` en audit log, redirigir a `/login` (sin `?expired`).

- [ ] **Step 6: Verificar audit log completo**

```sql
SELECT event, count(*) FROM session_audit_log WHERE user_id = '<test-uuid>' GROUP BY event;
```
Deben aparecer: `created`, `heartbeat`, uno de `expired_idle`/`expired_absolute`, `user_logout`.

---

## Task 13: Deploy a producción

- [ ] **Step 1: Set env vars en Supabase Edge Functions**

```bash
supabase secrets set SESSION_IDLE_TIMEOUT_SECONDS=900
supabase secrets set SESSION_ABSOLUTE_LIFETIME_SECONDS=28800
supabase secrets set SESSION_PRIVILEGED_IDLE_SECONDS=600
supabase secrets set SESSION_PRIVILEGED_ABSOLUTE_SECONDS=14400
```

Recomendado adicional (Supabase Dashboard → Auth → JWT expiry): bajar a 900s (15 min) para alinear con `SESSION_IDLE_TIMEOUT_SECONDS`. Esto hace que un access_token robado expire en ≤15 min incluso si nuestra revocación tardara.

- [ ] **Step 2: Push del branch a `main`**

```bash
git push origin main
```

- [ ] **Step 3: Verificar deploy en los 3 entornos Vercel**

```bash
npx vercel ls 2>&1 | head -10
```

Expected: 3 deployments ● Ready (securepaynet-app, securepaynet-wallet, securepaynet-app-prod) con timestamp reciente.

- [ ] **Step 4: Smoke test en producción**

Repetir Task 12 contra el dominio prod. Confirmar que tablas y audit log se pueblan.

---

## Definition of Done — Sprint 1

- [ ] Sesiones expiran por inactividad (validado en backend con `session-heartbeat` rechazando con `expired:idle`).
- [ ] Sesiones expiran por lifetime absoluto incluso con actividad (test forzando `absolute_expires_at`).
- [ ] Modal de aviso con cuenta regresiva funcional + botón "Seguir conectado" que extiende.
- [ ] Logs de auditoría completos (`created`, `heartbeat`, `expired_idle`, `expired_absolute`, `user_logout`).
- [ ] Roles privilegiados parametrizados (env vars + helper); cuando exista admin panel real, sólo hay que poblar `clientes.tipo`.
- [ ] Mensajes post-expiración en `/login` con motivo correcto.
- [ ] `auth.admin.signOut` invalida refresh_token en cada expiración/revocación.
