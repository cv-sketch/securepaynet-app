# Onboarding Rápido (sin KYC) + Passkey-Login — Design Spec

**Fecha:** 2026-04-27
**Estado:** En revisión
**Autor:** brainstorming session

## 1. Motivación y scope

### 1.1 Por qué

SecurePayNet App ya tiene login funcional (email + password vía Supabase Auth) y el infra completo de passkeys como step-up auth (Plan 2 de PR2 — usado en `/transferir` para confirmar operaciones sensibles). Lo que **no tiene**:

1. **Alta de cuenta nueva.** Hoy hay que crear `auth.users` + `clientes` + `wallets` a mano. Bloquea pasarle el link a testers.
2. **Login passwordless con passkey.** El passkey actual sirve para step-up post-login, pero el primer login siempre pide password (o Google si lo configurás). Si registrás un passkey, igual te van a seguir pidiendo el password.

Este spec resuelve ambos: **onboarding rápido NO-KYC** (Google + email/password con OTP, $5.000 ARS de mock balance) **y** **passkey-login from cold** (entrar a la app sin password si tenés passkey activado).

Cuando llegue el onboarding KYC real, este flow se reemplaza por uno con DNI/CUIT/selfie. Por ahora la app está en testeo cerrado y el goal es maximizar la velocidad de iteración con testers.

### 1.2 Lo que SÍ entra

**Onboarding:**
- Botón "Crear cuenta" en `/login`
- Página `/signup` con wizard de 3 pasos (elegir método → autenticar → activar passkey opcional)
- Auth con **Google OAuth** (sin OTP extra, Google ya verifica)
- Auth con **Email + Password** verificado por **OTP de 6 dígitos al mail**
- Edge Function `onboarding-complete` (idempotente) que crea `clientes` + `wallets` con `saldo = 5000`

**Passkey-login:**
- 2 Edge Functions nuevas: `passkey-login-begin` y `passkey-login-finish`, **anónimas** (sin requerir JWT previo)
- Cableo del botón "Ingresar con passkey" en `/login` al flow real (hoy es placeholder "proximamente")

### 1.3 Lo que NO entra (explícito)

- **KYC** — no DNI, no CUIT real, no Renaper. Stubeamos.
- **Verificación de teléfono** — `clientes.telefono` queda NULL.
- **Términos y condiciones acceptance flag** — la página `/legales` existe pero el signup no fuerza aceptación.
- **Captcha / anti-bot** — para 10-50 testers no hace falta, Supabase rate-limits los OTPs por sí solo.
- **Recuperación de contraseña** — fuera de scope. Si un tester olvida la password, le creamos otra cuenta o lo movés a passkey-only.
- **Onboarding multi-paso con tutorial** — sólo es "registrarse y entrar". Ningún tour guiado.
- **Personalización del email template** — usamos el default de Supabase (en inglés). Aceptable para testers.
- **Discoverable / autofill de passkeys** (entrar con passkey sin tipear email) — usamos email-first porque `residentKey: 'preferred'` no garantiza que la credential sea descubrible en todos los devices. Lo dejamos como mejora futura.
- **Onboarding empresarial** (`tipo = 'empresa'`).

---

## 2. Arquitectura

### 2.1 Diagrama de alto nivel

**Onboarding:**
```
┌──────────────┐  click "Crear cuenta"   ┌──────────────┐
│   /login     │ ──────────────────────► │   /signup    │
└──────────────┘                          └──────┬───────┘
                                                 │
                          ┌──────────────────────┴──────────────────────┐
                          │                                              │
                  Google OAuth                                  Email + Password
                          │                                              │
                  signInWithOAuth                          1. signUp({email, password})
                  → redirect Google                        2. Supabase manda OTP al mail
                  → callback /signup?step=onboarding       3. User entra código en UI
                          │                                4. verifyOtp({email, token, type:'email'})
                          │                                              │
                          └──────────────────────┬───────────────────────┘
                                                 │ session.access_token
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │  Edge Function: onboarding-complete    │
                              │  (idempotente)                          │
                              │  - Verifica JWT                         │
                              │  - Si no existe cliente para auth_uid:  │
                              │      INSERT clientes (stub nombre/cuit) │
                              │      INSERT wallets (saldo=5000)        │
                              └────────────────┬───────────────────────┘
                                                │
                                                ▼
                              ┌────────────────────────────────────────┐
                              │  Step 3 UI: "Activar acceso rápido"    │
                              │  ┌─────────┐  ┌──────────────┐         │
                              │  │ Activar │  │ Más tarde    │         │
                              │  └────┬────┘  └──────┬───────┘         │
                              └───────┼──────────────┼─────────────────┘
                                      │              │
                              passkey-register-      │
                              begin/finish (Plan 2)  │
                                      │              │
                                      └──────┬───────┘
                                             ▼
                                       redirect a /
                                       (Dashboard con $5.000)
```

**Passkey-login (en `/login`):**
```
┌──────────────────────────┐
│   /login                 │
│   Email: [juan@...]      │
│   ┌─────────────────────┐│
│   │ Ingresar con passkey││  click
│   └─────────────────────┘│
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│ passkeyService.loginBegin(email)     │
│     ↓                                 │
│ Edge Function: passkey-login-begin   │
│ (anónima, body { email })            │
│  - Resolver user_id por email        │
│    (admin API)                        │
│  - Fetch credential_ids del user     │
│  - generateAuthenticationOptions()   │
│  - INSERT en webauthn_challenges     │
│    (type='login')                     │
│  - Devolver { options }               │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ navigator.credentials.get(options)   │
│  (browser pide passkey al user)      │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ passkeyService.loginFinish(          │
│     email, credential)                │
│     ↓                                 │
│ Edge Function: passkey-login-finish  │
│ (anónima, body { email, credential })│
│  - Resolver user_id por email        │
│  - Levantar challenge de DB          │
│  - verifyAuthenticationResponse()    │
│  - UPDATE counter, last_used_at      │
│  - admin.auth.generateLink({         │
│      type:'magiclink', email })      │
│  - Devolver { hashed_token }          │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ supabase.auth.verifyOtp({            │
│     token_hash, type:'magiclink' })  │
│  → SESIÓN CREADA en el front          │
└──────────────┬───────────────────────┘
               │
               ▼
            redirect a /
```

### 2.2 Componentes y responsabilidades

| Pieza | Tipo | Responsabilidad |
|---|---|---|
| `src/pages/Signup.tsx` | React page (nueva) | Wizard de 3 pasos, controla estado local del flow |
| `src/pages/Login.tsx` | React page (modificar) | Agregar CTA "Crear cuenta" + cablear passkey-login real |
| `src/services/onboardingService.ts` | TS module (nuevo) | Wrappers de `signUp`, `verifyOtp`, `signInWithOAuth`, `onboarding-complete` |
| `src/services/passkeyService.ts` | TS module (modificar) | Agregar `loginBegin(email)` y `loginFinish(email, credential)` |
| `supabase/functions/onboarding-complete/index.ts` | Deno Edge Function (nueva) | Crea `clientes` + `wallets` con stubs si faltan |
| `supabase/functions/passkey-login-begin/index.ts` | Deno Edge Function (nueva, **anónima**) | Genera options de WebAuthn para usuario no logueado |
| `supabase/functions/passkey-login-finish/index.ts` | Deno Edge Function (nueva, **anónima**) | Verifica WebAuthn + emite magiclink hashed_token |
| `supabase/functions/_shared/cuitMock.ts` | Deno helper (nuevo) | Genera CUIT válido determinístico (reutiliza `cuit.ts` del Plan 1) |
| `supabase/migrations/20260428_onboarding_constraints.sql` | SQL migration (nueva) | UNIQUE en `clientes(auth_user_id)` |
| `src/store/useAuth.ts` | Existente, modificar | Agregar `signUpWithEmail`, `verifyEmailOtp`, `signInWithGoogle`, `signInWithPasskey` |

**Por qué Edge Function vs INSERT directo desde el front:**
- RLS confirmado: `clientes` y `wallets` no permiten INSERT a `authenticated` (sólo `is_admin()`).
- Atomicidad cliente + wallet.
- Idempotencia entre pestañas/recargas.

**Por qué `magiclink` hashed_token vs firmar JWT custom:**
- `auth.admin.generateLink` es una API pública/documentada de Supabase.
- No requiere acceso a `JWT_SECRET` ni firmar JWTs simétricamente desde Deno.
- El `hashed_token` es de uso único, expira en el mismo timeout que un magiclink normal.
- El front consume con `verifyOtp({ token_hash, type: 'magiclink' })` y obtiene una sesión normal de Supabase (con refresh_token automático).

### 2.3 Flow de datos detallado

**Email + Password signup:**
1. `/signup` → user elige "Email + contraseña" → form (email, password)
2. Front: `supabase.auth.signUp({ email, password })`
3. Supabase: crea `auth.users` con `email_confirmed_at = NULL`, manda email con código numérico de 6 dígitos
4. UI muestra input de OTP, user pega código
5. Front: `supabase.auth.verifyOtp({ email, token: code, type: 'email' })`
6. Supabase: confirma email, crea sesión activa
7. Front: llama `onboarding-complete` con Bearer JWT
8. Edge Function: crea `clientes` + `wallets` (idempotente)
9. UI pasa al Step 3 (passkey opcional)

**Google signup:**
1. `/signup` → user clickea "Continuar con Google"
2. Front: `signInWithOAuth({ provider: 'google', options: { redirectTo: '$ORIGIN/signup?step=onboarding' } })`
3. Supabase → Google → callback Supabase → callback `/signup?step=onboarding`
4. Front detecta query param, lee sesión activa, llama `onboarding-complete`
5. Mismo Step 3

**Passkey-login from cold:**
1. `/login` → user tipea email → click "Ingresar con passkey"
2. Front: `passkeyService.loginBegin(email)` → Edge Function `passkey-login-begin`
3. Edge Function: resuelve `user_id` por email vía admin API, fetch credentials, genera options, guarda challenge, devuelve options
4. Front: `navigator.credentials.get({ publicKey: options })` → usuario aprueba con biometría
5. Front: `passkeyService.loginFinish(email, credential)` → Edge Function `passkey-login-finish`
6. Edge Function: verifica assertion, update counter, llama `admin.generateLink({ type: 'magiclink', email })`, devuelve `hashed_token`
7. Front: `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` → sesión creada
8. Front: redirect a `/`

### 2.4 Concurrency / race conditions

- **Doble click en cualquier botón:** botones se desactivan durante request (`loading` state).
- **OTP expirado / inválido:** Supabase devuelve error tipado, front muestra "Reenviar código".
- **`onboarding-complete` race entre dos pestañas:** UNIQUE en `clientes.auth_user_id` + `ON CONFLICT DO NOTHING`. Una crea, la otra lee.
- **CUIT collision:** seed determinístico de `sha256(auth_user_id)` con prefijo `20`. Casi imposible colisión a esta escala. Si pasa, retry con seed alternativo (max 5).
- **`passkey-login-finish` replay attacks:** challenge se borra después de usar (single-use). Counter de WebAuthn previene replays del mismo assertion.
- **Enumeration de emails:** `passkey-login-begin` con email inexistente devuelve options vacío (0 credentials) → `navigator.credentials.get` falla del lado del browser sin distinguir "no existe" de "no tiene passkey". Mitigación parcial — para testers es aceptable.

---

## 3. Cambios de schema

### 3.1 Migración requerida

**Confirmado tras inspección:** `clientes` solo tiene `PRIMARY KEY (id)`. No hay UNIQUE en `auth_user_id`. Necesario para idempotencia del `ON CONFLICT DO NOTHING`.

```sql
-- supabase/migrations/20260428_onboarding_constraints.sql
ALTER TABLE clientes
  ADD CONSTRAINT clientes_auth_user_id_unique UNIQUE (auth_user_id);
```

### 3.2 RLS — sin cambios

Confirmado tras inspección:
- `clientes`: `clientes_select_own` (SELECT por `auth.uid() = auth_user_id`), `clientes_update_own` (UPDATE), `clientes_admin_all` (ALL si admin). **No hay INSERT/DELETE para `authenticated`** — lo que queremos.
- `wallets`: `wallets_select_own` (SELECT por cliente_id propio), `wallets_admin_all`. **No hay INSERT/DELETE para `authenticated`** — lo que queremos.

Las Edge Functions usan `service_role` y bypassan RLS. ✅

### 3.3 Stubs

| Campo | Valor stub | Razón |
|---|---|---|
| `clientes.nombre` | local-part del email (`juan` para `juan@gmail.com`) | Algo legible |
| `clientes.apellido` | `'Test'` | Marcador claro |
| `clientes.cuit` | `'20' + 9 dígitos derivados de sha256(auth_uid) + 1 dígito verificador BCRA` | Formato válido (mismo helper que `_shared/cuit.ts` del Plan 1), unicidad por derivación |
| `clientes.email` | el email de auth | Sincronizado |
| `clientes.telefono` | `NULL` | No pedimos teléfono |
| `clientes.tipo` | `'persona_fisica'` (default) | Único soportado |
| `wallets.saldo` | `5000.00` | Mock para testers |
| `wallets.moneda` | `'ARS'` (default) | Único soportado |
| `wallets.cvu` | `'0000003'` (mock prefix) `+ 15 dígitos derivados` | Formato CVU válido, no apunta a cuenta real |
| `wallets.alias` | `'test.{first8charsClienteId}.spn'` | Legible y único |

---

## 4. Edge Function: `onboarding-complete`

### 4.1 Endpoint

`POST /functions/v1/onboarding-complete`

### 4.2 Auth

Header `Authorization: Bearer ${session.access_token}`. Edge Function valida vía `userClient.auth.getUser()`.

### 4.3 Body

Vacío.

### 4.4 Lógica

```
1. Validar JWT → auth_user_id, email
2. SELECT id FROM clientes WHERE auth_user_id = $1
3. Si existe:
     SELECT cvu, alias, saldo FROM wallets WHERE cliente_id = $cliente_id
     RETURN { ok: true, cliente_id, wallet, created: false }
4. Si NO existe:
     attempt = 0
     loop max 5:
       cuit = generateCuitMock(auth_user_id, attempt)
       INSERT INTO clientes (auth_user_id, email, nombre, apellido, cuit, tipo)
         VALUES ($1, $email, $local_part, 'Test', $cuit, 'persona_fisica')
         ON CONFLICT (auth_user_id) DO NOTHING
         RETURNING id
       Si UNIQUE violation en cuit: attempt++, continue
       Si éxito: break
     Si después de 5 intentos no hay cliente_id:
       SELECT id FROM clientes WHERE auth_user_id = $1  (otro proceso lo creó)
     INSERT INTO wallets (cliente_id, saldo, moneda, cvu, alias)
       VALUES ($cliente_id, 5000.00, 'ARS', $cvu_mock, $alias)
       ON CONFLICT (cliente_id) DO NOTHING
     SELECT cvu, alias, saldo FROM wallets WHERE cliente_id = $cliente_id
     RETURN { ok: true, cliente_id, wallet, created: true }
```

### 4.5 Respuesta

```json
{
  "ok": true,
  "cliente_id": "uuid",
  "wallet": {
    "cvu": "0000003123456789012345",
    "alias": "test.a1b2c3d4.spn",
    "saldo": "5000.00",
    "moneda": "ARS"
  },
  "created": true
}
```

### 4.6 Errores

- `401`: JWT inválido / ausente
- `500`: error inesperado de DB

---

## 4b. Edge Functions: `passkey-login-begin` / `passkey-login-finish`

### 4b.1 `passkey-login-begin`

**Endpoint:** `POST /functions/v1/passkey-login-begin`
**Auth:** anónima (sin Bearer requerido) — el JWT del anon key alcanza vía CORS.
**Body:** `{ "email": "user@example.com" }`

**Lógica:**
```
1. Validar email (formato básico)
2. user_id = await admin.auth.admin.listUsers({ filter: 'email='+email })
   → si no existe: devolver options con allowCredentials=[] (no enumerar)
3. credentials = SELECT credential_id, transports FROM user_passkeys WHERE user_id = $user_id
4. options = generateAuthenticationOptions({
     rpID: WEBAUTHN_RP_ID,
     allowCredentials: credentials.map(c => ({ id: c.credential_id, transports: c.transports })),
     userVerification: 'preferred',
     timeout: 60000
   })
5. INSERT INTO webauthn_challenges (user_id, challenge, type) VALUES ($user_id, options.challenge, 'login')
   (si user_id null por step 2, no insertamos — el verify va a fallar más adelante)
6. RETURN { ok: true, options }
```

### 4b.2 `passkey-login-finish`

**Endpoint:** `POST /functions/v1/passkey-login-finish`
**Auth:** anónima
**Body:**
```json
{
  "email": "user@example.com",
  "credential": { "id": "...", "rawId": "...", "response": { "...assertion..." }, "type": "public-key" }
}
```

**Lógica:**
```
1. user_id = admin.auth.admin.listUsers({ filter })  → si no existe, 401
2. challenge_row = SELECT * FROM webauthn_challenges
                    WHERE user_id=$1 AND type='login'
                    ORDER BY created_at DESC LIMIT 1
   Si no hay o expiró (>5 min): 401
3. authenticator = SELECT credential_id, public_key, counter, transports
                    FROM user_passkeys
                    WHERE user_id=$1 AND credential_id=$credential.id
   Si no existe: 401
4. result = verifyAuthenticationResponse({
     response: credential,
     expectedChallenge: challenge_row.challenge,
     expectedOrigin: WEBAUTHN_ORIGIN,
     expectedRPID: WEBAUTHN_RP_ID,
     authenticator: { credentialID, credentialPublicKey, counter, transports }
   })
   Si !verified: 401
   Si counter <= stored counter: 401 (CLONED_CREDENTIAL)
5. UPDATE user_passkeys SET counter=$new, last_used_at=NOW() WHERE id=$auth.id
6. DELETE FROM webauthn_challenges WHERE id=$challenge_row.id  (single-use)
7. link = await admin.auth.admin.generateLink({ type: 'magiclink', email: $email })
   (no usamos `redirectTo` porque consumimos `hashed_token` directamente, no navegamos al action_link)
8. RETURN { ok: true, hashed_token: link.properties.hashed_token, type: 'magiclink' }
```

### 4b.3 Respuesta `passkey-login-finish`

```json
{ "ok": true, "hashed_token": "abc123...", "type": "magiclink" }
```

El front consume:
```ts
await supabase.auth.verifyOtp({ token_hash: hashed_token, type: 'magiclink' })
// → sesión creada, supabase setea access + refresh tokens
```

### 4b.4 Errores

- `400`: body malformado
- `401`: email no existe / passkey no encontrada / verificación falló / challenge expirado / counter inválido
- `500`: error inesperado

---

## 5. Front-end

### 5.1 Routing

Agregar a `src/App.tsx`:

```tsx
<Route path="/signup" element={<Signup />} />
```

`Signup` NO va dentro de `<Protected>`.

### 5.2 `src/pages/Signup.tsx` — wizard de 3 pasos

State machine interno:

```ts
type Step =
  | { kind: 'choose-method' }
  | { kind: 'email-password-form' }
  | { kind: 'verify-otp', email: string }
  | { kind: 'completing-onboarding' }
  | { kind: 'passkey-prompt' }
  | { kind: 'done' }
```

Transiciones:
- `choose-method` → click Google → `signInWithOAuth` (redirect, vuelve a `/signup?step=onboarding`)
- `choose-method` → click "Email + password" → `email-password-form`
- `email-password-form` → submit OK → `verify-otp`
- `verify-otp` → submit OK → `completing-onboarding`
- `verify-otp` → "reenviar código" → re-llama `signUp` o `signInWithOtp({ shouldCreateUser: false })`
- `completing-onboarding` → llamada a Edge Function OK → `passkey-prompt`
- `passkey-prompt` → "Activar" → `passkeyService.registerCurrentDevice()` → `done`
- `passkey-prompt` → "Más tarde" → `done`
- `done` → redirect a `/`

Detección de `?step=onboarding` (return de Google OAuth) en `useEffect` al mount: salta directo a `completing-onboarding`.

### 5.3 `src/pages/Login.tsx` — cambios

1. **CTA "Crear cuenta":** debajo del botón "Ingresar":
   ```tsx
   <Link to="/signup" className="block text-center text-xs text-brand-600 hover:underline mt-3">
     ¿No tenés cuenta? Crear cuenta
   </Link>
   ```

2. **Reemplazar `handlePasskey` por flow real:** el botón actual (que muestra "proximamente") pasa a:
   ```tsx
   const handlePasskey = async () => {
     if (!email.trim()) {
       setError('Tipeá tu email primero')
       return
     }
     setError(null); setLoading(true)
     try {
       await useAuth.getState().signInWithPasskey(email)
       nav('/', { replace: true })
     } catch (err: any) {
       setError(err.message ?? 'No se pudo ingresar con passkey')
     } finally {
       setLoading(false)
     }
   }
   ```

3. **El input de password queda visible siempre** — el usuario elige usar password o passkey con el mismo email. No requiere "modo passkey vs modo password".

### 5.4 `src/services/onboardingService.ts` (nuevo)

```ts
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export const onboardingService = {
  signUpWithEmail: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  },

  verifyEmailOtp: async (email: string, code: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email, token: code, type: 'email'
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
      options: { redirectTo }
    })
    if (error) throw error
  },

  completeOnboarding: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('No active session')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })
    const json = await res.json()
    if (!json.ok) throw new Error(json.message ?? 'Onboarding failed')
    return json
  },
}
```

### 5.5 `src/services/passkeyService.ts` (extender)

Agregar:

```ts
async loginBegin(email: string): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const { data, error } = await supabase.functions.invoke('passkey-login-begin', { body: { email } })
  if (error || !data?.ok) throw new Error(error?.message ?? data?.message ?? 'Login begin failed')
  return { options: data.options }
},

async loginFinish(email: string, credential: AuthenticationResponseJSON): Promise<{ hashedToken: string }> {
  const { data, error } = await supabase.functions.invoke('passkey-login-finish', {
    body: { email, credential }
  })
  if (error || !data?.ok) {
    const code = data?.code ?? 'AUTH_FAILED'
    throw new Error(code === 'CLONED_CREDENTIAL' ? 'CLONED_CREDENTIAL' : (error?.message ?? data?.message ?? 'Auth failed'))
  }
  return { hashedToken: data.hashed_token }
},
```

### 5.6 `src/store/useAuth.ts` — agregar acciones

```ts
type State = {
  // ...existentes
  signUpWithEmail: (email: string, password: string) => Promise<void>
  verifyEmailOtp: (email: string, code: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithPasskey: (email: string) => Promise<void>
}

// implementación:
signUpWithEmail: async (email, password) => {
  await onboardingService.signUpWithEmail(email, password)
},
verifyEmailOtp: async (email, code) => {
  await onboardingService.verifyEmailOtp(email, code)
  await onboardingService.completeOnboarding()
  // listener onAuthStateChange recarga cliente
},
signInWithGoogle: async () => {
  const redirectTo = `${window.location.origin}/signup?step=onboarding`
  await onboardingService.signInWithGoogle(redirectTo)
  // redirect; el resto del flow ocurre al volver
},
signInWithPasskey: async (email) => {
  const { options } = await passkeyService.loginBegin(email)
  const credential = await authenticateCredential(options)
  const { hashedToken } = await passkeyService.loginFinish(email, credential)
  const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
  if (error) throw error
  // listener onAuthStateChange carga cliente
},
```

**Idempotencia post-login (recovery):** El wizard de `/signup` setea `sessionStorage.setItem('onboarding-pending', '1')` al entrar. Después del OTP/Google success, llama `completeOnboarding()` y borra el flag. Si el user cierra el browser entre medio, el flag persiste en sessionStorage de esa pestaña — pero más importante: en `useAuth.hydrate()`, si `cliente == null` Y existe el flag `onboarding-pending`, llamamos `completeOnboarding()` y limpiamos el flag.

**Por qué no llamar siempre `completeOnboarding` cuando `cliente == null`:** evitar el footgun de crear automáticamente un cliente stub para usuarios admin (que tienen `auth.users` row pero pueden no tener `clientes` row a propósito). El flag `onboarding-pending` discrimina entre "vine de signup wizard" vs "soy admin loguéandose". Si un signup queda colgado sin el flag (caso edge raro), el user vuelve a `/signup` con el mismo email → el wizard detecta sesión activa + cliente faltante y arranca desde `completing-onboarding`.

---

## 6. Configuración manual (sólo el user puede hacerla)

Antes de testear el flow completo:

### 6.1 Habilitar Google OAuth en Supabase

1. Ir a https://console.cloud.google.com/apis/credentials
2. Crear OAuth 2.0 Client ID, tipo "Web application"
3. Authorized redirect URI: `https://lkqyzyvfcnfzihhlhuru.supabase.co/auth/v1/callback`
4. Copiar Client ID + Secret
5. En Supabase Dashboard → Authentication → Providers → Google → enable + pegar credenciales
6. En Authentication → URL Configuration:
   - Site URL: URL prod del Vercel (ej. `https://app.securepaynet.ar` o similar)
   - Redirect URLs: agregar `<site-url>/signup`, `http://localhost:5173/signup`

### 6.2 Verificar email confirmation

1. Authentication → Settings → "Confirm email" debe estar **ON**
2. (Opcional) Authentication → Email Templates → "Confirm signup" personalizar a castellano

### 6.3 Variables de entorno

`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` ya están seteadas (login funciona). Confirmar.

---

## 7. Testing

### 7.1 Deno tests

**`_shared/cuitMock_test.ts`:**
- `cuitMock(uid, 0)` genera CUIT con dígito verificador correcto (re-usar `cuitCheckDigit` de Plan 1)
- Determinístico para mismo `uid`
- `attempt=0` vs `attempt=1` da CUITs distintos
- Empieza con prefijo `'20'`

**Edge Functions (`onboarding-complete`, `passkey-login-begin/finish`):** este repo no tiene infra de tests de Edge Functions con DB (Plans 1-3 sólo testean shared helpers). Aplicamos el mismo patrón: la lógica de las Edge Functions se valida via **smoke test end-to-end con curl + browser** (sección 7.2), no con tests unitarios mockeados. Esto es coherente con el tamaño del proyecto y evita sobre-ingeniería de mocks de Postgres.

### 7.2 Smoke test manual (browser)

**Onboarding email+password:**
1. Abrir `/signup` en incógnito
2. Elegir "Email + contraseña", ingresar `tester.r1+oboard@gmail.com` + password
3. Verificar que llega OTP al mail
4. Pegar código → debe pasar a Step 3
5. Saltear passkey ("Más tarde") → debe llegar a Dashboard con `$5.000.00`
6. Sign out

**Passkey-login from cold (mismo user):**
1. Volver a `/login`, tipear email del Step 5
2. Click "Ingresar con passkey"
3. Esperado: error claro porque no registró passkey

**Onboarding con passkey activado:**
4. Repetir signup con `tester.r1+oboard2@gmail.com`
5. En Step 3 click "Activar passkey" → completar ceremonia biometría
6. Llegar a Dashboard
7. Sign out
8. `/login`, tipear el email, click "Ingresar con passkey"
9. Aprobar biometría → debe entrar al Dashboard sin pedir password

**Onboarding Google:**
10. `/signup` → "Continuar con Google" → flujo Google → debe llegar a Dashboard con `$5.000.00`

### 7.3 Verificación post-deploy

- `clientes_auth_user_id_unique` constraint existe (Mgmt API query)
- `onboarding-complete`, `passkey-login-begin`, `passkey-login-finish` deployadas
- Edge Function logs no muestran 500s

---

## 8. Riesgos y consideraciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Google OAuth credentials no configuradas al deploy | Botón Google falla en prod | Implementación deja botón visible pero loggea error claro si provider no disponible. User configura antes de testear con terceros. |
| Built-in SMTP de Supabase tiene rate limit (~30/h) | Testers no reciben OTP | Aceptable para 10-50 testers iniciales. Si se cruza el límite, esperar 1h o conectar Resend/SendGrid. |
| `admin.auth.admin.generateLink` requiere service_role | Si Edge Function falla en autenticarse contra admin, `passkey-login-finish` rompe | El env var `SUPABASE_SERVICE_ROLE_KEY` ya está seteado (Plan 2 lo usa). Verificar al deployar. |
| Enumeration de emails por timing/error | Atacante puede confirmar si un email está registrado probando passkey-login | Mitigación parcial: `begin` siempre devuelve options (vacías si no existe). Para testers internos, riesgo aceptable. |
| `cuit` collision | INSERT falla, retry loop dispara | Cubierto: max 5 retries con seed alternativo |
| Tester olvida password Y no tiene passkey | No puede entrar | Aceptable: crear cuenta nueva o admin-reset desde Supabase dashboard |
| Tester registra passkey y limpia browser/cambia device | No puede entrar con passkey desde el nuevo device, sigue funcionando con password | Aceptable; documentar para testers |
| Edge Function `onboarding-complete` falla post-OTP | User queda con `auth.users` pero sin cliente/wallet | Idempotencia + retry en `useAuth.hydrate` y listener `SIGNED_IN` |
| `verifyOtp({type: 'magiclink'})` con hashed_token consumido dos veces | El segundo intento falla | Comportamiento esperado de Supabase (single-use). Front maneja con error genérico. |
| Magiclink hashed_token expira antes del `verifyOtp` (latencia red) | Login con passkey falla raro | Default magiclink expiry es 1h — mucho margen. Si se cruza, error claro al user. |
| Lockdown Plan 3 revoca INSERT en `contactos` | No afecta este flow | Ninguna |

---

## 9. Out of scope (recordatorio)

- KYC (DNI, selfie, Renaper, AFIP)
- Onboarding empresarial (`tipo = 'empresa'`)
- Términos y condiciones acceptance flag
- Verificación de teléfono
- Recuperación de password
- Personalización del email template
- Captcha / anti-bot
- Internacionalización del flow
- Onboarding multi-paso con tutorial
- Rate-limiting custom
- **Discoverable / autofill de passkeys** (entrar sin tipear email) — necesita asegurar `residentKey: 'required'` y resolver `userHandle` en server. Lo dejamos para iteración futura.
- **Passkey-as-2FA** (mantener password + agregar passkey como segundo factor obligatorio) — distinto a passkey-as-login.
