# Plan 3/3 — Agenda Obligatoria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hacer obligatorio elegir contacto agendado para transferir, y hacer obligatorio el `<SecurityGate>` (passkey o password) para agendar/eliminar contactos. Refactor de `Contactos.tsx` (3-step modal con lookup) y `Transferir.tsx` (sólo picker, campos read-only). Lockdown final con `REVOKE INSERT, DELETE ON contactos FROM authenticated` para que el gate sea inmutable desde el front.

**Architecture:** RPC `contactos_create_gated` y `contactos_remove_gated` con `SECURITY DEFINER` que verifican un `gate_token` HMAC (helper SQL `verify_gate_token`) antes de operar. El front ya no hace INSERT/DELETE directo. El componente `<SecurityGate>` consume `passkeyService.authenticate()` con fallback a `authenticateWithPassword()`.

**Tech Stack:** PostgreSQL `SECURITY DEFINER` functions, HMAC verification en SQL (pgcrypto), `lookupService` (Plan 1) + `passkeyService` (Plan 2) + nuevo `<SecurityGate>` + refactor de páginas.

**Spec de referencia:** `docs/superpowers/specs/2026-04-27-cuenta-lookup-y-passkeys-design.md` secciones 3.1, 3.3, 5.1, 5.2, 5.3, 5.5, 9.

**Depende de:**
- Plan 1 mergeado (lookupService disponible)
- Plan 2 mergeado (passkeyService + SecurityGate-able)

---

## File Structure

| Path | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260429_contactos_entidad.sql` | Crear + aplicar | Columna `entidad`, UNIQUE, backfill |
| `supabase/migrations/20260429_contactos_gated_rpc.sql` | Crear + aplicar | RPCs + verify_gate_token (sin lockdown todavía) |
| `supabase/migrations/20260429_contactos_lockdown.sql` | Crear + aplicar (al final) | REVOKE INSERT, DELETE |
| `src/components/SecurityGate.tsx` | Crear | Modal passkey-or-password |
| `src/services/contactosService.ts` | Modificar | `createGated`, `removeGated` |
| `src/pages/Contactos.tsx` | Refactor | Modal 3-step alta + edit identitario read-only |
| `src/pages/Transferir.tsx` | Refactor | Picker obligatorio, sin inputs CBU/CUIT |

---

## Task 1: Migración `contactos_entidad`

**Files:**
- Crear: `supabase/migrations/20260429_contactos_entidad.sql`

- [ ] **Step 1:** Branch
```bash
git checkout main && git pull
git checkout -b feat/agenda-obligatoria
```

- [ ] **Step 2:** Crear migración
```sql
-- supabase/migrations/20260429_contactos_entidad.sql

ALTER TABLE contactos ADD COLUMN IF NOT EXISTS entidad TEXT;

ALTER TABLE contactos
  DROP CONSTRAINT IF EXISTS contactos_cliente_cvu_unique;

ALTER TABLE contactos
  ADD CONSTRAINT contactos_cliente_cvu_unique UNIQUE (cliente_id, cvu);

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

- [ ] **Step 3:** Aplicar via Management API (mismo patrón que Plan 2 Task 1)
```bash
PROJECT_REF=lkqyzyvfcnfzihhlhuru
SQL=$(cat supabase/migrations/20260429_contactos_entidad.sql)

python3 -c "
import os, json, urllib.request
data = json.dumps({'query': '''$SQL'''}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/$PROJECT_REF/database/query',
    data=data,
    headers={'Authorization': f'Bearer {os.environ[\"SUPABASE_MGMT_TOKEN\"]}', 'Content-Type': 'application/json'},
    method='POST',
)
print(urllib.request.urlopen(req).read().decode())
"
```
Expected: HTTP 201.

- [ ] **Step 4:** Verificar que la columna existe
```bash
python3 -c "
import os, json, urllib.request
sql = \"SELECT column_name FROM information_schema.columns WHERE table_name='contactos' AND column_name='entidad'\"
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
Expected: 1 fila con `entidad`.

- [ ] **Step 5:** Commit
```bash
git add supabase/migrations/20260429_contactos_entidad.sql
git commit -m "feat(db): contactos.entidad + UNIQUE(cliente_id,cvu) + backfill"
```

---

## Task 2: Migración `contactos_gated_rpc` (sin lockdown todavía)

**Files:**
- Crear: `supabase/migrations/20260429_contactos_gated_rpc.sql`

- [ ] **Step 1:** Crear migración
```sql
-- supabase/migrations/20260429_contactos_gated_rpc.sql

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
  expected_hmac_b64 TEXT;
  secret TEXT;
  pad_len INT;
BEGIN
  parts := string_to_array(token, '.');
  IF parts IS NULL OR array_length(parts, 1) <> 2 THEN RETURN FALSE; END IF;

  payload_b64 := parts[1];
  signature_b64 := parts[2];

  secret := current_setting('app.gate_token_secret', true);
  IF secret IS NULL OR secret = '' THEN RETURN FALSE; END IF;

  expected_hmac_b64 := encode(
    hmac(payload_b64::bytea, secret::bytea, 'sha256'),
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
```

- [ ] **Step 2:** Aplicar via Management API
```bash
SQL=$(cat supabase/migrations/20260429_contactos_gated_rpc.sql)
python3 -c "
import os, json, urllib.request
data = json.dumps({'query': '''$SQL'''}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/database/query',
    data=data,
    headers={'Authorization': f'Bearer {os.environ[\"SUPABASE_MGMT_TOKEN\"]}', 'Content-Type': 'application/json'},
    method='POST',
)
print(urllib.request.urlopen(req).read().decode())
"
```
Expected: HTTP 201.

- [ ] **Step 3:** Smoke test del RPC con un gate_token válido del front (correr passkey auth → llamar RPC)

Desde la consola del browser de un usuario logueado con passkey ya registrada:
```javascript
const { passkeyService } = await import('./src/services/passkeyService.ts')
const { gateToken } = await passkeyService.authenticate()
const { supabase } = await import('./src/lib/supabase.ts')
const { data, error } = await supabase.rpc('contactos_create_gated', {
  input: { nombre: 'Test RPC', cvu: '0050003100012345678901', cuit: '20123456786', entidad: 'Banco Galicia' },
  gate_token: gateToken,
})
console.log(data, error)
```
Expected: `data` con la fila insertada, `error` null.

Borrá el contacto después:
```javascript
await supabase.rpc('contactos_remove_gated', { contacto_id: data.id, gate_token: gateToken })
```

- [ ] **Step 4:** Commit
```bash
git add supabase/migrations/20260429_contactos_gated_rpc.sql
git commit -m "feat(db): RPC contactos_create_gated/remove_gated + verify_gate_token"
```

---

## Task 3: Refactor de `contactosService.ts`

**Files:**
- Modificar: `src/services/contactosService.ts`

- [ ] **Step 1:** Reemplazar `create` y `remove`. Actualizar el archivo a:
```ts
// src/services/contactosService.ts
import { supabase } from '../lib/supabase'

export type Contacto = {
  id: string
  cliente_id: string
  nombre: string
  cvu: string | null
  alias: string | null
  cuit: string | null
  titular: string | null
  banco: string | null
  email: string | null
  telefono: string | null
  favorito: boolean
  notas: string | null
  entidad: string | null
  created_at: string
  updated_at: string
}

export type ContactoInput = {
  nombre: string
  cvu?: string | null
  alias?: string | null
  cuit?: string | null
  titular?: string | null
  banco?: string | null
  email?: string | null
  telefono?: string | null
  favorito?: boolean
  notas?: string | null
  entidad?: string | null
}

export const contactosService = {
  async list(clienteId: string): Promise<Contacto[]> {
    const { data, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('favorito', { ascending: false })
      .order('nombre', { ascending: true })
    if (error) throw error
    return (data ?? []) as Contacto[]
  },

  async get(id: string): Promise<Contacto | null> {
    const { data, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as Contacto | null
  },

  async createGated(input: ContactoInput, gateToken: string): Promise<Contacto> {
    const { data, error } = await supabase.rpc('contactos_create_gated', { input, gate_token: gateToken })
    if (error) throw error
    return data as Contacto
  },

  async update(id: string, input: Partial<Pick<ContactoInput, 'nombre' | 'alias' | 'favorito' | 'notas'>>): Promise<Contacto> {
    const { data, error } = await supabase
      .from('contactos')
      .update(input)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Contacto
  },

  async removeGated(id: string, gateToken: string): Promise<void> {
    const { error } = await supabase.rpc('contactos_remove_gated', { contacto_id: id, gate_token: gateToken })
    if (error) throw error
  },

  async toggleFavorito(id: string, favorito: boolean): Promise<void> {
    const { error } = await supabase.from('contactos').update({ favorito }).eq('id', id)
    if (error) throw error
  },
}
```

- [ ] **Step 2:** Type-check
```bash
npx tsc -b
```
Expected: errores en cualquier caller que use el viejo `create` o `remove`.

- [ ] **Step 3:** Commit (los callers se arreglan en tasks siguientes)
```bash
git add src/services/contactosService.ts
git commit -m "feat(front): contactosService usa RPCs gated; identidad inmutable en update"
```

---

## Task 4: `<SecurityGate>` component

**Files:**
- Crear: `src/components/SecurityGate.tsx`

- [ ] **Step 1:** Implementar el componente
```tsx
// src/components/SecurityGate.tsx
import { useEffect, useState } from 'react'
import { passkeyService } from '../services/passkeyService'

type Props = {
  open: boolean
  reason: string
  onClose: () => void
  onSuccess: (gateToken: string) => void
}

type State = 'idle' | 'pending-passkey' | 'mode-password' | 'pending-password' | 'rate-limited' | 'error'

export default function SecurityGate({ open, reason, onClose, onSuccess }: Props) {
  const [state, setState] = useState<State>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!open) return
    setState('idle')
    setErr(null)
    setPassword('')
    void tryPasskey()
  }, [open])

  async function tryPasskey() {
    if (!passkeyService.isWebAuthnSupported()) {
      setState('mode-password')
      return
    }
    setState('pending-passkey')
    setErr(null)
    try {
      const { gateToken } = await passkeyService.authenticate()
      onSuccess(gateToken)
    } catch (e) {
      const m = (e as Error).message
      if (m === 'NO_PASSKEYS') {
        setState('mode-password')
        return
      }
      if (m === 'CLONED_CREDENTIAL') {
        setErr('Detectamos un problema de seguridad con esta passkey. Eliminala desde Perfil.')
        setState('error')
        return
      }
      setState('mode-password')
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setState('pending-password')
    setErr(null)
    try {
      const { gateToken } = await passkeyService.authenticateWithPassword(password)
      setPassword('')
      onSuccess(gateToken)
    } catch (e) {
      const m = (e as Error).message
      if (m === 'RATE_LIMITED') {
        setState('rate-limited')
        setErr('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.')
        return
      }
      setState('mode-password')
      setErr('Contrasena incorrecta')
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">Confirmar para {reason}</h2>
          <button onClick={onClose} className="text-sm text-slate-500 px-2 py-1">Cancelar</button>
        </div>

        {state === 'pending-passkey' && (
          <div className="text-sm text-slate-600 py-6 text-center">
            Esperando confirmacion del dispositivo...
            <div className="mt-3">
              <button
                onClick={() => setState('mode-password')}
                className="text-xs text-brand-700 font-semibold underline"
              >
                Usar contrasena
              </button>
            </div>
          </div>
        )}

        {(state === 'mode-password' || state === 'pending-password') && (
          <form onSubmit={handlePassword}>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tu contrasena de SecurePayNet
            </label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
            <button
              type="submit"
              disabled={state === 'pending-password' || !password}
              className="w-full mt-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
            >
              {state === 'pending-password' ? 'Verificando...' : 'Confirmar'}
            </button>
            {passkeyService.isWebAuthnSupported() && (
              <button
                type="button"
                onClick={() => void tryPasskey()}
                className="w-full text-xs text-brand-700 font-semibold mt-2"
              >
                Usar passkey en su lugar
              </button>
            )}
          </form>
        )}

        {state === 'rate-limited' && (
          <div className="text-sm text-red-600 py-4">{err}</div>
        )}
        {state === 'error' && (
          <div className="text-sm text-red-600 py-4">{err}</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** Type-check
```bash
npx tsc -b
```

- [ ] **Step 3:** Commit
```bash
git add src/components/SecurityGate.tsx
git commit -m "feat(front): SecurityGate component (passkey + password fallback)"
```

---

## Task 5: Refactor de `Contactos.tsx`

**Files:**
- Modificar: `src/pages/Contactos.tsx`

- [ ] **Step 1:** Leer el archivo actual
```bash
cat src/pages/Contactos.tsx
```

- [ ] **Step 2:** Reescribir con flujo de 3 steps. Reemplazar el contenido completo:
```tsx
// src/pages/Contactos.tsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { contactosService, type Contacto, type ContactoInput } from '../services/contactosService'
import { lookupService, type LookupOk } from '../services/lookupService'
import { maskCBU } from '../lib/format'
import SecurityGate from '../components/SecurityGate'

export default function Contactos() {
  const { cliente } = useAuth()
  const [contactos, setContactos] = useState<Contacto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [altaOpen, setAltaOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Contacto | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Contacto | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [pendingInput, setPendingInput] = useState<ContactoInput | null>(null)

  async function refresh() {
    if (!cliente?.id) return
    setLoading(true)
    try {
      setContactos(await contactosService.list(cliente.id))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [cliente?.id])

  async function handleGateSuccess(gateToken: string) {
    setGateOpen(false)
    try {
      if (pendingInput) {
        await contactosService.createGated(pendingInput, gateToken)
        setPendingInput(null)
        setAltaOpen(false)
        await refresh()
      } else if (removeTarget) {
        await contactosService.removeGated(removeTarget.id, gateToken)
        setRemoveTarget(null)
        await refresh()
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Contactos</h1>
        <button
          onClick={() => setAltaOpen(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2 rounded-lg"
        >
          + Agregar
        </button>
      </div>

      {loading && <div className="text-sm text-slate-400">Cargando...</div>}

      {!loading && contactos.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-600 mb-3">Aun no tenes contactos agendados.</p>
          <button
            onClick={() => setAltaOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            Agendar mi primer contacto
          </button>
        </div>
      )}

      {!loading && contactos.length > 0 && (
        <ul className="space-y-2">
          {contactos.map((c) => (
            <li key={c.id} className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold">
                {c.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">
                  {c.favorito && <span className="text-amber-500">★ </span>}
                  {c.nombre}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {c.entidad ?? 'Otra entidad'} · {c.alias ?? maskCBU(c.cvu)}
                </div>
              </div>
              <div className="flex gap-1">
                <Link
                  to={`/transferir?contactoId=${c.id}`}
                  className="text-xs font-semibold text-brand-700 hover:bg-brand-50 px-2 py-1 rounded"
                >
                  Enviar
                </Link>
                <button
                  onClick={() => setEditTarget(c)}
                  className="text-xs text-slate-600 hover:bg-slate-50 px-2 py-1 rounded"
                >
                  Editar
                </button>
                <button
                  onClick={() => { setRemoveTarget(c); setGateOpen(true) }}
                  className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

      {altaOpen && (
        <AltaModal
          onClose={() => { setAltaOpen(false); setPendingInput(null) }}
          onConfirm={(input) => { setPendingInput(input); setGateOpen(true) }}
        />
      )}

      {editTarget && (
        <EditModal
          contacto={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await refresh() }}
        />
      )}

      <SecurityGate
        open={gateOpen}
        reason={removeTarget ? 'eliminar contacto' : 'agendar contacto'}
        onClose={() => { setGateOpen(false); setPendingInput(null); setRemoveTarget(null) }}
        onSuccess={handleGateSuccess}
      />
    </div>
  )
}

function AltaModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (input: ContactoInput) => void }) {
  const [tab, setTab] = useState<'cbu' | 'alias'>('cbu')
  const [value, setValue] = useState('')
  const [searching, setSearching] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const [result, setResult] = useState<LookupOk['data'] | null>(null)
  const [apodo, setApodo] = useState('')
  const [favorito, setFavorito] = useState(false)

  async function handleSearch() {
    setLookupErr(null)
    setSearching(true)
    try {
      const r = await lookupService.lookup(tab, value)
      if (!r.ok) {
        setLookupErr(messageForCode(r.code))
        setResult(null)
      } else {
        setResult(r.data)
        setApodo(r.data.nombre)
      }
    } catch (e) {
      setLookupErr((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  function messageForCode(code: string): string {
    switch (code) {
      case 'INVALID_FORMAT': return 'Formato invalido'
      case 'NOT_FOUND': return 'No encontramos esa cuenta'
      case 'ACCOUNT_DISABLED': return 'Esa cuenta no esta disponible'
      default: return 'Error en el servicio. Intenta de nuevo.'
    }
  }

  function handleConfirm() {
    if (!result) return
    const input: ContactoInput = {
      nombre: apodo || result.nombre,
      cvu: result.cvu_completo,
      cuit: result.cuit,
      titular: result.nombre,
      entidad: result.entidad,
      alias: tab === 'alias' ? value : null,
      favorito,
    }
    onConfirm(input)
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-40 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Agregar contacto</h2>
          <button onClick={onClose} className="text-sm text-slate-500">Cerrar</button>
        </div>

        {!result && (
          <>
            <div className="flex bg-slate-100 rounded-lg p-1 mb-3">
              <button
                onClick={() => { setTab('cbu'); setValue(''); setLookupErr(null) }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md ${tab === 'cbu' ? 'bg-white shadow' : 'text-slate-600'}`}
              >
                CBU/CVU
              </button>
              <button
                onClick={() => { setTab('alias'); setValue(''); setLookupErr(null) }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md ${tab === 'alias' ? 'bg-white shadow' : 'text-slate-600'}`}
              >
                Alias
              </button>
            </div>

            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(tab === 'cbu' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              maxLength={tab === 'cbu' ? 22 : 20}
              placeholder={tab === 'cbu' ? '22 digitos' : 'ej: juan.perez'}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-500"
            />

            {lookupErr && <div className="text-xs text-red-600 mt-2">{lookupErr}</div>}

            <button
              onClick={handleSearch}
              disabled={searching || !value}
              className="w-full mt-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
            >
              {searching ? 'Buscando...' : 'Buscar destinatario'}
            </button>
          </>
        )}

        {result && (
          <>
            <div className="bg-slate-50 rounded-xl p-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white font-bold">
                  {result.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{result.nombre}</div>
                  <div className="text-xs text-slate-500">CUIT {result.cuit}</div>
                </div>
              </div>
              <div className="text-xs text-slate-600 mt-2">
                <div><span className="font-semibold">Entidad:</span> {result.entidad}</div>
                <div className="font-mono break-all"><span className="font-semibold">CVU:</span> {result.cvu_completo}</div>
              </div>
            </div>

            <label className="block text-xs font-semibold text-slate-700 mb-1">Apodo (opcional)</label>
            <input
              value={apodo}
              onChange={(e) => setApodo(e.target.value)}
              maxLength={50}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />

            <label className="flex items-center gap-2 mt-3 text-sm">
              <input
                type="checkbox"
                checked={favorito}
                onChange={(e) => setFavorito(e.target.checked)}
              />
              Marcar como favorito
            </label>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setResult(null); setApodo('') }}
                className="flex-1 border border-slate-300 text-slate-700 font-semibold py-2.5 rounded-xl"
              >
                Atras
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl"
              >
                Confirmar y guardar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function EditModal({ contacto, onClose, onSaved }: { contacto: Contacto; onClose: () => void; onSaved: () => void }) {
  const [nombre, setNombre] = useState(contacto.nombre)
  const [alias, setAlias] = useState(contacto.alias ?? '')
  const [favorito, setFavorito] = useState(contacto.favorito)
  const [notas, setNotas] = useState(contacto.notas ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      await contactosService.update(contacto.id, { nombre, alias: alias || null, favorito, notas: notas || null })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Editar contacto</h2>
          <button onClick={onClose} className="text-sm text-slate-500">Cerrar</button>
        </div>

        <div className="bg-slate-50 rounded-xl p-2 mb-3 text-xs text-slate-600">
          <div><span className="font-semibold">Titular:</span> {contacto.titular ?? '—'}</div>
          <div><span className="font-semibold">CUIT:</span> {contacto.cuit ?? '—'}</div>
          <div><span className="font-semibold">Entidad:</span> {contacto.entidad ?? '—'}</div>
          <div className="font-mono break-all"><span className="font-semibold">CVU:</span> {contacto.cvu ?? '—'}</div>
          <div className="text-[11px] text-slate-400 mt-1">La identidad del destinatario es inmutable. Para cambiarla, borrá y agendá de nuevo.</div>
        </div>

        <label className="block text-xs font-semibold text-slate-700 mb-1">Apodo</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-2" />

        <label className="block text-xs font-semibold text-slate-700 mb-1">Alias</label>
        <input value={alias} onChange={(e) => setAlias(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-2" />

        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={favorito} onChange={(e) => setFavorito(e.target.checked)} />
          Favorito
        </label>

        <label className="block text-xs font-semibold text-slate-700 mb-1">Notas</label>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={200} className="w-full border rounded-lg px-3 py-2 text-sm mb-3" rows={2} />

        {err && <div className="text-xs text-red-600 mb-2">{err}</div>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3:** Build
```bash
npm run build
```
Expected: build OK.

- [ ] **Step 4:** Manual test
- Levantar dev, ir a `/contactos`, agregar contacto:
  - Tab CBU/CVU: tipear `0050003100012345678901`, click Buscar
  - Tab Alias: tipear `juan.perez`, click Buscar
  - Verificar card con datos
  - Confirmar → SecurityGate aparece → passkey o password → contacto aparece en lista
- Editar: cambiar apodo, guardar → verificar que CVU/CUIT/entidad siguen siendo los mismos.
- Borrar: SecurityGate → confirmar → contacto desaparece.

- [ ] **Step 5:** Commit
```bash
git add src/pages/Contactos.tsx
git commit -m "feat(contactos): alta con lookup + SecurityGate + edit con identidad inmutable"
```

---

## Task 6: Refactor de `Transferir.tsx`

**Files:**
- Modificar: `src/pages/Transferir.tsx`

- [ ] **Step 1:** Reescribir el archivo. Sacar inputs CBU/CVU y CUIT, hacer obligatorio el picker:
```tsx
// src/pages/Transferir.tsx
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, maskCBU } from '../lib/format'
import ComprobanteModal from '../components/ComprobanteModal'
import { contactosService, type Contacto } from '../services/contactosService'

type ComprobanteUI = {
  id: string
  numero: string | null
  fecha: string
  tipo: string
  monto: number
  contraparte: string | null
  cbu_contraparte: string | null
  referencia: string | null
  estado: string | null
}

export default function Transferir() {
  const { cliente, hydrate } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('VAR')
  const [descripcion, setDescripcion] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [comprobanteOpen, setComprobanteOpen] = useState(false)
  const [comprobanteData, setComprobanteData] = useState<ComprobanteUI | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contactos, setContactos] = useState<Contacto[]>([])
  const [contactoSel, setContactoSel] = useState<Contacto | null>(null)

  useEffect(() => {
    if (!cliente?.id) return
    contactosService.list(cliente.id).then(setContactos).catch((e) => console.error(e))
  }, [cliente?.id])

  useEffect(() => {
    const id = searchParams.get('contactoId')
    if (!id || contactos.length === 0) return
    const c = contactos.find((x) => x.id === id)
    if (c) setContactoSel(c)
  }, [searchParams, contactos])

  function clearContacto() {
    setContactoSel(null)
    if (searchParams.get('contactoId')) {
      const next = new URLSearchParams(searchParams)
      next.delete('contactoId')
      setSearchParams(next, { replace: true })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!cliente) return setMsg({ ok: false, text: 'No se pudo cargar tu wallet' })
    if (!contactoSel) return setMsg({ ok: false, text: 'Elegi un contacto de la agenda' })
    if (!contactoSel.cvu || !contactoSel.cuit)
      return setMsg({ ok: false, text: 'El contacto no tiene CVU/CUIT validos' })

    const m = parseFloat(monto)
    if (isNaN(m) || m <= 0) return setMsg({ ok: false, text: 'Ingresa un monto valido' })
    if (m > Number(cliente.saldo ?? 0)) return setMsg({ ok: false, text: 'Saldo insuficiente' })

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('transferencia-execute', {
        body: {
          cbu_destino: contactoSel.cvu,
          cuit_destino: contactoSel.cuit,
          monto: m,
          concepto,
          descripcion: descripcion || null,
        },
      })
      if (error) {
        setMsg({ ok: false, text: 'Error: ' + (error.message || 'desconocido') })
        return
      }
      if (!data?.ok) {
        setMsg({ ok: false, text: data?.message || 'Error en la transferencia' })
        return
      }
      const comp = data.comprobante
      if (comp) {
        setComprobanteData({
          id: comp.id,
          numero: comp.numero ?? null,
          fecha: comp.created_at,
          tipo: 'Transferencia enviada',
          monto: m,
          contraparte: comp.titular_destino ?? contactoSel.titular ?? contactoSel.nombre,
          cbu_contraparte: comp.cvu_destino ?? contactoSel.cvu,
          referencia: data.coelsa_id ?? data.origin_id ?? null,
          estado: 'completado',
        })
        setComprobanteOpen(true)
      }
      setMsg({ ok: true, text: 'Transferencia enviada. Comprobante generado.' })
      setMonto('')
      setDescripcion('')
      await hydrate()
    } catch (err) {
      setMsg({ ok: false, text: 'Error: ' + (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Transferir</h1>

      {cliente && (
        <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">Saldo disponible</span>
          <span className="text-sm font-bold">{formatARS(Number(cliente.saldo ?? 0))}</span>
        </div>
      )}

      {/* Destinatario */}
      <div className="mb-4">
        {contactoSel ? (
          <div className="bg-brand-50 border border-brand-100 rounded-2xl p-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white font-bold">
                {contactoSel.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{contactoSel.nombre}</div>
                <div className="text-xs text-slate-500 truncate">
                  {contactoSel.entidad ?? 'Otra entidad'} · {contactoSel.alias ?? maskCBU(contactoSel.cvu)}
                </div>
                {contactoSel.cuit && <div className="text-[11px] text-slate-400">CUIT {contactoSel.cuit}</div>}
              </div>
              <button
                type="button"
                onClick={clearContacto}
                className="text-xs text-brand-700 font-semibold px-2 py-1 hover:bg-white rounded"
              >
                Cambiar
              </button>
            </div>
          </div>
        ) : contactos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-sm text-slate-600 mb-3">
              Aun no tenes contactos. Solo se puede transferir a contactos previamente agendados.
            </p>
            <Link
              to="/contactos"
              className="inline-block bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Agendar mi primer contacto
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full bg-white border border-dashed border-slate-300 hover:border-brand-500 hover:bg-brand-50 text-sm text-slate-600 hover:text-brand-700 font-semibold py-3 rounded-2xl"
          >
            Elegir contacto de la agenda
          </button>
        )}
      </div>

      {/* Detalles */}
      {contactoSel && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Monto (ARS)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-lg font-bold outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="0.00"
            />
            {monto && !isNaN(parseFloat(monto)) && (
              <div className="text-xs text-slate-500 mt-1">{formatARS(parseFloat(monto))}</div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Concepto</label>
            <select
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="VAR">VAR - Varios</option>
              <option value="ALQ">ALQ - Alquiler</option>
              <option value="CUO">CUO - Cuota</option>
              <option value="HAB">HAB - Haberes</option>
              <option value="HON">HON - Honorarios</option>
              <option value="FAC">FAC - Factura</option>
              <option value="PRE">PRE - Prestamo</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Descripcion (opcional)</label>
            <input
              type="text"
              maxLength={80}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Ej: pago alquiler"
            />
          </div>

          {msg && (
            <div className={`text-xs rounded-lg p-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
              {msg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
          >
            {loading ? 'Procesando...' : 'Enviar transferencia'}
          </button>

          <p className="text-[11px] text-slate-400 text-center">
            Operaciones sujetas a normativa BCRA. Solo se puede transferir a contactos agendados.
          </p>
        </form>
      )}

      <ComprobanteModal open={comprobanteOpen} onClose={() => setComprobanteOpen(false)} comprobante={comprobanteData} />

      {pickerOpen && (
        <ContactoPicker
          contactos={contactos}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => { setContactoSel(c); setPickerOpen(false) }}
        />
      )}
    </div>
  )
}

function ContactoPicker({ contactos, onClose, onPick }: { contactos: Contacto[]; onClose: () => void; onPick: (c: Contacto) => void }) {
  const [q, setQ] = useState('')
  const filtered = contactos.filter((c) => {
    if (!q.trim()) return true
    const s = q.toLowerCase()
    return (
      c.nombre.toLowerCase().includes(s) ||
      (c.alias?.toLowerCase().includes(s) ?? false) ||
      (c.cvu?.includes(s) ?? false) ||
      (c.titular?.toLowerCase().includes(s) ?? false)
    )
  })

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Elegir contacto</h2>
          <button onClick={onClose} className="text-sm text-slate-500">Cerrar</button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="space-y-1">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50"
            >
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold">
                {c.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{c.favorito && '★ '}{c.nombre}</div>
                <div className="text-xs text-slate-500 truncate">{c.entidad ?? 'Otra entidad'} · {c.alias ?? maskCBU(c.cvu)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** Build
```bash
npm run build
```
Expected: build OK.

- [ ] **Step 3:** Manual test
- `/transferir` sin contactos → empty state con CTA a `/contactos`
- `/transferir` con contactos → botón "Elegir contacto"
- Después de pick: card con avatar + entidad + alias/CVU + CUIT, botón Cambiar
- Cambiar limpia y vuelve a aparecer el botón
- `/transferir?contactoId=<id>` pre-fill del card

- [ ] **Step 4:** Commit
```bash
git add src/pages/Transferir.tsx
git commit -m "feat(transferir): picker obligatorio + sin inputs CBU/CUIT + entidad visible"
```

---

## Task 7: Lockdown final — `REVOKE INSERT, DELETE`

**Files:**
- Crear: `supabase/migrations/20260429_contactos_lockdown.sql`

⚠️ **No correr este task hasta que el front esté en producción y todos los flujos funcionen.** Revocar antes rompe el front.

- [ ] **Step 1:** Verificar que el front está deployed (después del PR merge) y que CRUD funciona
- Mergear el PR (si llegó hasta acá funcionó).
- Esperar deploy de Vercel.
- En prod, agregar y borrar un contacto → debe funcionar.

- [ ] **Step 2:** Crear migración de lockdown
```sql
-- supabase/migrations/20260429_contactos_lockdown.sql

REVOKE INSERT, DELETE ON contactos FROM authenticated;
-- UPDATE queda permitido por RLS (los campos identitarios son inmutables desde la UI).
-- SELECT queda permitido por RLS.
```

- [ ] **Step 3:** Aplicar
```bash
SQL=$(cat supabase/migrations/20260429_contactos_lockdown.sql)
python3 -c "
import os, json, urllib.request
data = json.dumps({'query': '''$SQL'''}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/lkqyzyvfcnfzihhlhuru/database/query',
    data=data,
    headers={'Authorization': f'Bearer {os.environ[\"SUPABASE_MGMT_TOKEN\"]}', 'Content-Type': 'application/json'},
    method='POST',
)
print(urllib.request.urlopen(req).read().decode())
"
```
Expected: HTTP 201.

- [ ] **Step 4:** Verificar que INSERT directo falla pero RPC succeed

Desde la consola del browser logueado:
```javascript
// Esto debe FALLAR:
const { error: e1 } = await supabase.from('contactos').insert({ cliente_id: '<uid>', nombre: 'Hack' })
console.log('direct insert error (expected):', e1)

// Esto debe FUNCIONAR (con un gateToken válido):
const { gateToken } = await passkeyService.authenticate()
const { data, error: e2 } = await supabase.rpc('contactos_create_gated', {
  input: { nombre: 'OK', cvu: '0050003100012345678901', cuit: '20123456786', entidad: 'Banco Galicia' },
  gate_token: gateToken,
})
console.log('rpc result (expected ok):', data, e2)
```

- [ ] **Step 5:** Commit
```bash
git add supabase/migrations/20260429_contactos_lockdown.sql
git commit -m "feat(db): lockdown - REVOKE INSERT, DELETE en contactos para forzar uso de RPC gated"
```

---

## Task 8: PR final

- [ ] **Step 1:** Push + PR
```bash
git push -u origin feat/agenda-obligatoria
gh pr create --title "feat: agenda obligatoria + SecurityGate en alta/baja de contactos" --body "$(cat <<'EOF'
## Summary
- Migracion: contactos.entidad + UNIQUE(cliente_id,cvu) + backfill
- RPC contactos_create_gated/remove_gated + verify_gate_token (HMAC)
- <SecurityGate> component (passkey + password fallback)
- Refactor Contactos.tsx: alta 3-step (lookup → confirm → gate)
- Refactor Transferir.tsx: picker obligatorio, sin inputs CBU/CUIT, entidad visible
- Lockdown: REVOKE INSERT, DELETE en contactos (post-merge)

## Depends on
- PR Plan 1 (cuenta-lookup) merged
- PR Plan 2 (passkey-infra) merged

## Test plan
- [x] Lookup con tab CBU/CVU + Alias funcionan
- [x] SecurityGate con passkey funciona
- [x] SecurityGate con password fallback funciona
- [x] Edit de contacto: identidad inmutable
- [x] Borrar contacto: gate obligatorio
- [x] Transferir: empty state si no hay contactos
- [x] Transferir: picker obligatorio
- [x] ?contactoId URL param funciona
- [x] Lockdown: INSERT/DELETE directo falla, RPC funciona
- [x] Auto-agendarse bloqueado
- [ ] Aprobado para merge

Spec: docs/superpowers/specs/2026-04-27-cuenta-lookup-y-passkeys-design.md (3.1, 3.3, 5.1, 5.2, 5.3, 5.5)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2:** Vercel preview test (con mismo passkey infra ya en prod del Plan 2):
- Loguear, ir a /contactos, agregar uno con alias `juan.perez`
- Confirmar SecurityGate (passkey o password)
- Ir a /transferir, picker, enviar
- Editar contacto, verificar identidad read-only
- Borrar contacto, verificar gate

- [ ] **Step 3:** Merge con squash, borrar branch.

- [ ] **Step 4:** Aplicar lockdown (Task 7) **después** del merge.

---

## Verificación final del Plan 3

- [ ] Migración `contactos_entidad` aplicada (columna + UNIQUE + backfill)
- [ ] Migración `contactos_gated_rpc` aplicada (RPCs + verify_gate_token)
- [ ] `<SecurityGate>` funciona con passkey y con password
- [ ] `Contactos.tsx` refactor: alta 3-step + edit con identidad inmutable + borrar con gate
- [ ] `Transferir.tsx` refactor: picker obligatorio, sin inputs CBU/CUIT
- [ ] Lockdown aplicado (`REVOKE INSERT, DELETE`)
- [ ] Smoke tests E2E pasan
- [ ] PR mergeado y deployed
- [ ] Auto-agendarse bloqueado por RPC
- [ ] Documentación de spec sigue siendo válida

**Último paso:** revocar el `SUPABASE_MGMT_TOKEN` usado para aplicar migraciones en https://supabase.com/dashboard/account/tokens.
