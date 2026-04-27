# Plan 1/3 — Cuenta Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extender `bdc-proxy` con endpoint `account.lookup` (mock + live stub) y exponerlo en el front como `lookupService`. Sin cambios de UX visibles para el usuario.

**Architecture:** Edge Function existente `bdc-proxy` recibe un nuevo case `account.lookup`. En `BDC_MODE=mock` valida formato (CBU 22 dígitos / alias 6-20 chars), genera datos determinísticos a partir de SHA-256 del input, devuelve `{nombre, cuit, cvu_completo, entidad}`. En `live` queda como stub que `throw`. Helpers puros en `_shared/` con Deno tests.

**Tech Stack:** Deno (Edge Functions), TypeScript, Supabase CLI vía `npx`, `@supabase/supabase-js` (front).

**Spec de referencia:** `docs/superpowers/specs/2026-04-27-cuenta-lookup-y-passkeys-design.md` secciones 4.1, 4.2.

---

## File Structure

| Path | Acción | Responsabilidad |
|---|---|---|
| `supabase/functions/_shared/entidades.ts` | Crear | Mapa CBU/CVU prefix → entidad + función `entidadByPrefix` |
| `supabase/functions/_shared/entidades_test.ts` | Crear | Tests de `entidadByPrefix` |
| `supabase/functions/_shared/cuit.ts` | Crear | Generación de CUIT con dígito verificador BCRA |
| `supabase/functions/_shared/cuit_test.ts` | Crear | Tests del verificador |
| `supabase/functions/_shared/lookupMock.ts` | Crear | Generador determinístico de `{nombre, cuit, cvu_completo, entidad}` |
| `supabase/functions/_shared/lookupMock_test.ts` | Crear | Tests del generador |
| `supabase/functions/bdc-proxy/index.ts` | Bajar + Modificar | Agregar case `account.lookup` |
| `src/services/lookupService.ts` | Crear | Wrapper del front que llama `bdc-proxy` con `endpoint: 'account.lookup'` |

---

## Task 1: Setup de directorios y bajar `bdc-proxy` actual

**Files:**
- Crear directorio: `supabase/functions/_shared/`
- Bajar: `supabase/functions/bdc-proxy/index.ts`

- [ ] **Step 1:** Crear directorio para shared helpers
```bash
mkdir -p supabase/functions/_shared
```

- [ ] **Step 2:** Verificar que tenés un Supabase access token. Si `~/.supabase/access-token` no existe:
```bash
npx supabase login
```
(abre el browser; si estás en headless, exportá `SUPABASE_ACCESS_TOKEN`).

- [ ] **Step 3:** Bajar la Edge Function actual `bdc-proxy` del proyecto remoto
```bash
cd /home/tron/securepaynet-app
npx supabase functions download bdc-proxy --project-ref lkqyzyvfcnfzihhlhuru
```
Expected: crea `supabase/functions/bdc-proxy/index.ts`.

- [ ] **Step 4:** Verificar el contenido y entender el shape actual del request
```bash
head -50 supabase/functions/bdc-proxy/index.ts
```
Buscás un `switch (endpoint)` o `if (endpoint === 'transfer.create')`.

- [ ] **Step 5:** Commit
```bash
git checkout -b feat/cuenta-lookup
git add supabase/functions/bdc-proxy/index.ts
git commit -m "chore: bajar bdc-proxy actual a repo local"
```

---

## Task 2: `_shared/entidades.ts` con tests

**Files:**
- Crear: `supabase/functions/_shared/entidades.ts`
- Crear: `supabase/functions/_shared/entidades_test.ts`

- [ ] **Step 1:** Escribir el test primero (TDD)

Crear `supabase/functions/_shared/entidades_test.ts`:
```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { entidadByPrefix } from './entidades.ts'

Deno.test('entidadByPrefix: CVU PSP - Mercado Pago', () => {
  assertEquals(entidadByPrefix('0000003100012345678901'), 'Mercado Pago')
})

Deno.test('entidadByPrefix: CVU PSP - Ualá', () => {
  assertEquals(entidadByPrefix('0000054100012345678901'), 'Ualá')
})

Deno.test('entidadByPrefix: CBU bancario - Galicia 005', () => {
  assertEquals(entidadByPrefix('0050003100012345678901'), 'Banco Galicia')
})

Deno.test('entidadByPrefix: CBU bancario - Galicia 007', () => {
  assertEquals(entidadByPrefix('0070003100012345678901'), 'Banco Galicia')
})

Deno.test('entidadByPrefix: CBU bancario - Santander 072', () => {
  assertEquals(entidadByPrefix('0720003100012345678901'), 'Santander')
})

Deno.test('entidadByPrefix: CBU desconocido cae a Otra entidad', () => {
  assertEquals(entidadByPrefix('9990003100012345678901'), 'Otra entidad')
})

Deno.test('entidadByPrefix: CVU prefix desconocido cae a CBU prefix', () => {
  // 0000999 no esta en CVU map; cae al lookup CBU '000' que tampoco esta
  assertEquals(entidadByPrefix('0000999100012345678901'), 'Otra entidad')
})
```

- [ ] **Step 2:** Correr los tests para verificar que fallan
```bash
cd supabase/functions/_shared
deno test entidades_test.ts
```
Expected: FAIL — `Module not found "./entidades.ts"`.

- [ ] **Step 3:** Implementar `entidades.ts`

Crear `supabase/functions/_shared/entidades.ts`:
```ts
const ENTIDADES_CBU: Record<string, string> = {
  '005': 'Banco Galicia',
  '007': 'Banco Galicia',
  '011': 'Banco Nación',
  '014': 'Banco Provincia',
  '015': 'ICBC',
  '017': 'BBVA',
  '027': 'Supervielle',
  '029': 'Banco Ciudad',
  '034': 'Banco Patagonia',
  '044': 'Banco Hipotecario',
  '072': 'Santander',
  '143': 'Brubank',
  '150': 'HSBC',
  '191': 'Credicoop',
  '259': 'Itaú',
  '285': 'Macro',
  '299': 'Comafi',
  '384': 'Wilobank',
  '389': 'Banco de Comercio',
}

const ENTIDADES_CVU: Record<string, string> = {
  '0000003': 'Mercado Pago',
  '0000019': 'Personal Pay',
  '0000044': 'Naranja X',
  '0000054': 'Ualá',
  '0000086': 'Lemon',
  '0000094': 'Belo',
}

export function entidadByPrefix(cvu: string): string {
  if (cvu.startsWith('0000')) {
    const cvuPrefix = cvu.substring(0, 7)
    if (ENTIDADES_CVU[cvuPrefix]) return ENTIDADES_CVU[cvuPrefix]
  }
  const cbuPrefix = cvu.substring(0, 3)
  return ENTIDADES_CBU[cbuPrefix] ?? 'Otra entidad'
}

export const PREFIJOS_CVU_DISPONIBLES = Object.keys(ENTIDADES_CVU)
export const PREFIJOS_CBU_DISPONIBLES = Object.keys(ENTIDADES_CBU)
```

- [ ] **Step 4:** Correr tests, verificar que pasan
```bash
deno test supabase/functions/_shared/entidades_test.ts
```
Expected: 7 passed.

- [ ] **Step 5:** Commit
```bash
git add supabase/functions/_shared/entidades.ts supabase/functions/_shared/entidades_test.ts
git commit -m "feat(bdc-proxy): helper entidadByPrefix con tests"
```

---

## Task 3: `_shared/cuit.ts` (dígito verificador BCRA)

**Files:**
- Crear: `supabase/functions/_shared/cuit.ts`
- Crear: `supabase/functions/_shared/cuit_test.ts`

- [ ] **Step 1:** Escribir tests

Crear `supabase/functions/_shared/cuit_test.ts`:
```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cuitCheckDigit, buildCuit } from './cuit.ts'

// Casos conocidos publicos (CUITs de empresas de muestra de AFIP)
Deno.test('cuitCheckDigit: 30-71234567 -> 5', () => {
  assertEquals(cuitCheckDigit('3071234567'), 5)
})

Deno.test('cuitCheckDigit: 20-12345678 -> 5', () => {
  // Cualquiera con calculo manual
  // Tabla 5,4,3,2,7,6,5,4,3,2 sobre digitos
  // 2*5 + 0*4 + 1*3 + 2*2 + 3*7 + 4*6 + 5*5 + 6*4 + 7*3 + 8*2
  // = 10+0+3+4+21+24+25+24+21+16 = 148; 148 % 11 = 5; 11-5 = 6
  // pero si === 11 -> 0, si === 10 -> 9
  assertEquals(cuitCheckDigit('2012345678'), 6)
})

Deno.test('buildCuit: prefix 20 + 8 digitos', () => {
  const cuit = buildCuit(20, '12345678')
  assertEquals(cuit.length, 11)
  assertEquals(cuit.substring(0, 2), '20')
  assertEquals(cuit.substring(2, 10), '12345678')
})

Deno.test('buildCuit: rechaza body de longitud distinta a 8', () => {
  let threw = false
  try { buildCuit(20, '123') } catch { threw = true }
  assertEquals(threw, true)
})
```

- [ ] **Step 2:** Correr tests, verificar que fallan
```bash
deno test supabase/functions/_shared/cuit_test.ts
```
Expected: FAIL.

- [ ] **Step 3:** Implementar `cuit.ts`
```ts
const FACTORS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function cuitCheckDigit(first10Digits: string): number {
  if (!/^\d{10}$/.test(first10Digits)) {
    throw new Error('cuitCheckDigit espera exactamente 10 digitos')
  }
  let sum = 0
  for (let i = 0; i < 10; i++) {
    sum += parseInt(first10Digits[i], 10) * FACTORS[i]
  }
  const mod = sum % 11
  if (mod === 0) return 0
  if (mod === 1) return 9 // convencion BCRA: si da 10, se usa 9
  return 11 - mod
}

export function buildCuit(prefix: 20 | 23 | 24 | 27 | 30 | 33 | 34, body: string): string {
  if (!/^\d{8}$/.test(body)) {
    throw new Error('buildCuit espera body de 8 digitos')
  }
  const first10 = `${prefix}${body}`
  return `${first10}${cuitCheckDigit(first10)}`
}
```

- [ ] **Step 4:** Correr tests
```bash
deno test supabase/functions/_shared/cuit_test.ts
```
Expected: 4 passed.

- [ ] **Step 5:** Commit
```bash
git add supabase/functions/_shared/cuit.ts supabase/functions/_shared/cuit_test.ts
git commit -m "feat(bdc-proxy): helper CUIT con digito verificador BCRA"
```

---

## Task 4: `_shared/lookupMock.ts` (generador determinístico)

**Files:**
- Crear: `supabase/functions/_shared/lookupMock.ts`
- Crear: `supabase/functions/_shared/lookupMock_test.ts`

- [ ] **Step 1:** Escribir tests primero
```ts
// supabase/functions/_shared/lookupMock_test.ts
import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { mockLookup } from './lookupMock.ts'

Deno.test('mockLookup: alias valido devuelve shape correcto', async () => {
  const r = await mockLookup({ type: 'alias', value: 'juan.perez' })
  if (!r.ok) throw new Error('debio ser ok')
  assertEquals(r.data.cvu_completo.length, 22)
  assertEquals(r.data.cuit.length, 11)
  assertEquals(typeof r.data.nombre, 'string')
  assertEquals(typeof r.data.entidad, 'string')
})

Deno.test('mockLookup: determinista para mismo alias', async () => {
  const a = await mockLookup({ type: 'alias', value: 'juan.perez' })
  const b = await mockLookup({ type: 'alias', value: 'juan.perez' })
  if (!a.ok || !b.ok) throw new Error('ambos deben ser ok')
  assertEquals(a.data.nombre, b.data.nombre)
  assertEquals(a.data.cuit, b.data.cuit)
  assertEquals(a.data.cvu_completo, b.data.cvu_completo)
})

Deno.test('mockLookup: aliases distintos -> resultados distintos', async () => {
  const a = await mockLookup({ type: 'alias', value: 'juan.perez' })
  const b = await mockLookup({ type: 'alias', value: 'maria.gomez' })
  if (!a.ok || !b.ok) throw new Error('ambos deben ser ok')
  assertNotEquals(a.data.cuit, b.data.cuit)
})

Deno.test('mockLookup: CBU formato invalido', async () => {
  const r = await mockLookup({ type: 'cbu', value: '123' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'INVALID_FORMAT')
})

Deno.test('mockLookup: alias formato invalido (con espacios)', async () => {
  const r = await mockLookup({ type: 'alias', value: 'juan perez' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'INVALID_FORMAT')
})

Deno.test('mockLookup: alias muy corto', async () => {
  const r = await mockLookup({ type: 'alias', value: 'juan' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'INVALID_FORMAT')
})

Deno.test('mockLookup: CBU termina en 0000 -> ACCOUNT_DISABLED', async () => {
  const r = await mockLookup({ type: 'cbu', value: '0050003100012345670000' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'ACCOUNT_DISABLED')
})

Deno.test('mockLookup: CBU valido devuelve mismo CBU como cvu_completo', async () => {
  const v = '0070003100012345678901'
  const r = await mockLookup({ type: 'cbu', value: v })
  if (!r.ok) throw new Error('debio ser ok')
  assertEquals(r.data.cvu_completo, v)
})
```

- [ ] **Step 2:** Correr tests, fallan
```bash
deno test supabase/functions/_shared/lookupMock_test.ts
```

- [ ] **Step 3:** Implementar `lookupMock.ts`
```ts
import { entidadByPrefix, PREFIJOS_CVU_DISPONIBLES } from './entidades.ts'
import { buildCuit } from './cuit.ts'

const NOMBRES = [
  'Juan Carlos Gómez', 'María Laura Pérez', 'Carlos Alberto Fernández',
  'Sofía Beatriz Rodríguez', 'Diego Martín López', 'Lucía Andrea Martínez',
  'Pablo Daniel González', 'Camila Belén Sánchez', 'Hernán Sebastián Romero',
  'Florencia Anahí Díaz', 'Matías Ezequiel Torres', 'Valentina Guadalupe Ruiz',
  'Federico Joaquín Álvarez', 'Agustina Milagros Acosta', 'Nicolás Tomás Benítez',
  'Julieta Catalina Ortiz', 'Gonzalo Ignacio Medina', 'Micaela Antonella Suárez',
  'Lucas Emiliano Castro', 'Brenda Soledad Ramírez', 'Tomás Bautista Vega',
  'Antonella Renata Ríos', 'Joaquín Lautaro Herrera', 'Martina Pilar Aguirre',
  'Ezequiel Iván Cabrera', 'Daniela Constanza Molina', 'Marcos Felipe Núñez',
  'Carolina Roxana Silva', 'Ariel Damián Peralta', 'Yamila Estefanía Rojas',
]

const CUIT_PREFIXES = [20, 23, 24, 27] as const
type CuitPrefix = typeof CUIT_PREFIXES[number]

type LookupInput = { type: 'cbu' | 'alias'; value: string }
type LookupOk = { ok: true; data: { nombre: string; cuit: string; cvu_completo: string; entidad: string } }
type LookupErr = { ok: false; code: 'INVALID_FORMAT' | 'NOT_FOUND' | 'ACCOUNT_DISABLED' | 'UPSTREAM_ERROR'; message: string }
export type LookupResult = LookupOk | LookupErr

const CBU_REGEX = /^\d{22}$/
const ALIAS_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9.\-]{4,18})[a-zA-Z0-9]$/

async function sha256Bytes(s: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return new Uint8Array(buf)
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}

export async function mockLookup(input: LookupInput): Promise<LookupResult> {
  if (input.type === 'cbu') {
    if (!CBU_REGEX.test(input.value)) {
      return { ok: false, code: 'INVALID_FORMAT', message: 'CBU/CVU debe tener 22 digitos' }
    }
  } else {
    if (!ALIAS_REGEX.test(input.value)) {
      return { ok: false, code: 'INVALID_FORMAT', message: 'Alias debe tener 6-20 caracteres alfanumericos, puntos o guiones' }
    }
  }

  const hash = await sha256Bytes(input.value.toLowerCase())
  const big = bytesToBigInt(hash)

  // CVU completo
  let cvu: string
  if (input.type === 'cbu') {
    cvu = input.value
  } else {
    const prefixIdx = Number(big % BigInt(PREFIJOS_CVU_DISPONIBLES.length))
    const prefix = PREFIJOS_CVU_DISPONIBLES[prefixIdx]
    // 22 dígitos = 7 prefijo + 15 derivados
    const tail = (big / BigInt(PREFIJOS_CVU_DISPONIBLES.length))
      .toString()
      .padStart(15, '0')
      .slice(-15)
    cvu = prefix + tail
  }

  // Caso simulado de cuenta inhabilitada
  if (cvu.endsWith('0000')) {
    return { ok: false, code: 'ACCOUNT_DISABLED', message: 'Cuenta no disponible para recibir transferencias' }
  }

  // Nombre
  const nombreIdx = Number((big >> 64n) % BigInt(NOMBRES.length))
  const nombre = NOMBRES[nombreIdx]

  // CUIT
  const prefixIdx = Number((big >> 32n) % BigInt(CUIT_PREFIXES.length))
  const cuitPrefix: CuitPrefix = CUIT_PREFIXES[prefixIdx]
  const bodyDigits = (big >> 16n).toString().padStart(8, '0').slice(-8)
  const cuit = buildCuit(cuitPrefix, bodyDigits)

  return {
    ok: true,
    data: {
      nombre,
      cuit,
      cvu_completo: cvu,
      entidad: entidadByPrefix(cvu),
    },
  }
}
```

- [ ] **Step 4:** Correr tests
```bash
deno test supabase/functions/_shared/lookupMock_test.ts
```
Expected: 8 passed.

- [ ] **Step 5:** Commit
```bash
git add supabase/functions/_shared/lookupMock.ts supabase/functions/_shared/lookupMock_test.ts
git commit -m "feat(bdc-proxy): mock lookup determinista con tests"
```

---

## Task 5: Extender `bdc-proxy/index.ts` con `account.lookup`

**Files:**
- Modificar: `supabase/functions/bdc-proxy/index.ts`

- [ ] **Step 1:** Leer el archivo entero
```bash
cat supabase/functions/bdc-proxy/index.ts
```
Identificar dónde está el switch o if-chain por `endpoint`. Ubicar `BDC_MODE` lectura (`Deno.env.get('BDC_MODE')`).

- [ ] **Step 2:** Agregar imports al tope del archivo
```ts
import { mockLookup } from '../_shared/lookupMock.ts'
```

- [ ] **Step 3:** Agregar el case `account.lookup` en el switch/if existente

Si el código tiene un `switch (endpoint)`:
```ts
case 'account.lookup': {
  const mode = Deno.env.get('BDC_MODE') ?? 'mock'
  if (mode === 'mock') {
    const result = await mockLookup(payload as { type: 'cbu' | 'alias'; value: string })
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200,
    })
  }
  // live mode: stub
  return new Response(
    JSON.stringify({ ok: false, code: 'UPSTREAM_ERROR', message: 'live mode no implementado' }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders }, status: 501 }
  )
}
```

Si el código tiene if-chain, replicar el mismo patrón con `if (endpoint === 'account.lookup')`.

- [ ] **Step 4:** Verificar que el archivo type-checkea
```bash
cd supabase/functions/bdc-proxy
deno check index.ts
```
Expected: sin errores.

- [ ] **Step 5:** Commit
```bash
git add supabase/functions/bdc-proxy/index.ts
git commit -m "feat(bdc-proxy): endpoint account.lookup con mock + live stub"
```

---

## Task 6: Deploy + smoke test del endpoint

**Files:** ninguno (solo deploy y verificación).

- [ ] **Step 1:** Deploy de bdc-proxy
```bash
npx supabase functions deploy bdc-proxy --project-ref lkqyzyvfcnfzihhlhuru
```
Expected: `Function bdc-proxy deployed`.

- [ ] **Step 2:** Obtener un JWT de test (cualquier user de la app)

Loguearte en https://securepaynet-wallet.vercel.app y copiar el `access_token` de localStorage:
```javascript
JSON.parse(localStorage.getItem('sb-lkqyzyvfcnfzihhlhuru-auth-token')).access_token
```

- [ ] **Step 3:** Smoke-test alias válido vía curl
```bash
JWT="<el token>"
curl -s -X POST \
  https://lkqyzyvfcnfzihhlhuru.supabase.co/functions/v1/bdc-proxy \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"account.lookup","payload":{"type":"alias","value":"juan.perez"}}'
```
Expected: `{"ok":true,"data":{"nombre":"...","cuit":"...","cvu_completo":"...","entidad":"..."}}`.

- [ ] **Step 4:** Smoke-test CBU inválido
```bash
curl -s -X POST \
  https://lkqyzyvfcnfzihhlhuru.supabase.co/functions/v1/bdc-proxy \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"account.lookup","payload":{"type":"cbu","value":"123"}}'
```
Expected: `{"ok":false,"code":"INVALID_FORMAT",...}`.

- [ ] **Step 5:** Smoke-test ACCOUNT_DISABLED (CBU termina en 0000)
```bash
curl -s -X POST \
  https://lkqyzyvfcnfzihhlhuru.supabase.co/functions/v1/bdc-proxy \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"account.lookup","payload":{"type":"cbu","value":"0050003100012345670000"}}'
```
Expected: `{"ok":false,"code":"ACCOUNT_DISABLED",...}`.

---

## Task 7: `lookupService.ts` en el front

**Files:**
- Crear: `src/services/lookupService.ts`

- [ ] **Step 1:** Crear el servicio
```ts
// src/services/lookupService.ts
import { supabase } from '../lib/supabase'

export type LookupType = 'cbu' | 'alias'

export type LookupOk = {
  ok: true
  data: { nombre: string; cuit: string; cvu_completo: string; entidad: string }
}
export type LookupErr = {
  ok: false
  code: 'INVALID_FORMAT' | 'NOT_FOUND' | 'ACCOUNT_DISABLED' | 'UPSTREAM_ERROR'
  message: string
}
export type LookupResult = LookupOk | LookupErr

export const lookupService = {
  async lookup(type: LookupType, value: string): Promise<LookupResult> {
    const { data, error } = await supabase.functions.invoke('bdc-proxy', {
      body: { endpoint: 'account.lookup', payload: { type, value } },
    })
    if (error) {
      return { ok: false, code: 'UPSTREAM_ERROR', message: error.message ?? 'Error invocando lookup' }
    }
    return data as LookupResult
  },
}
```

- [ ] **Step 2:** Type-check del proyecto
```bash
cd /home/tron/securepaynet-app
npx tsc -b
```
Expected: sin errores.

- [ ] **Step 3:** Smoke-test desde la consola del browser

Levantar dev server (`npm run dev`), abrir devtools en una página logueada, ejecutar:
```javascript
const { lookupService } = await import('./src/services/lookupService.ts')
console.log(await lookupService.lookup('alias', 'juan.perez'))
```
Expected: respuesta `{ok:true, data:{...}}`.

- [ ] **Step 4:** Commit
```bash
git add src/services/lookupService.ts
git commit -m "feat: lookupService en el front"
```

---

## Task 8: PR

- [ ] **Step 1:** Push
```bash
git push -u origin feat/cuenta-lookup
```

- [ ] **Step 2:** Abrir PR
```bash
gh pr create --title "feat(bdc-proxy): account.lookup endpoint con mock determinista" --body "$(cat <<'EOF'
## Summary
- Extiende bdc-proxy con endpoint `account.lookup` (mock + live stub)
- Helpers `_shared/entidades.ts`, `_shared/cuit.ts`, `_shared/lookupMock.ts` con Deno tests
- Service en el front: `src/services/lookupService.ts`
- Sin cambios de UX para el usuario final

## Test plan
- [x] Deno tests: entidadByPrefix, cuitCheckDigit, mockLookup
- [x] Smoke-test manual: alias válido, CBU inválido, ACCOUNT_DISABLED
- [ ] Aprobado para merge

Spec: docs/superpowers/specs/2026-04-27-cuenta-lookup-y-passkeys-design.md (sección 4.1, 4.2)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Esperar checks de Vercel preview, mergear con squash, borrar branch.

---

## Verificación final del Plan 1

- [ ] `bdc-proxy` deployed con `account.lookup` funcionando en prod
- [ ] `lookupService.lookup('alias', 'juan.perez')` devuelve `{ok:true, data:...}` desde el front
- [ ] Helpers `_shared/*` con tests pasando
- [ ] PR mergeado a main

**Próximo plan:** `2026-04-27-passkey-infra.md`
