# SecurePayNet — Documentación Técnico-Funcional

> **Repo:** `cv-sketch/securepaynet-app` (frontend usuario)
> **Repo hermano:** `cv-sketch/bdcconecta-dashboard` (panel admin)
> **Backend compartido:** Supabase project `lkqyzyvfcnfzihhlhuru`
> **Producción usuario:** https://securepaynet-wallet.vercel.app
> **Última actualización:** 27/04/2026

---

## 1. Propósito del aplicativo

SecurePayNet es una **billetera virtual argentina** desarrollada para ser homologada por el **BCRA (Banco Central de la República Argentina)** a través del **Banco de Comercio (BDC)** mediante su API **BDC Conecta**.

El sistema simula y opera todas las primitivas de una PSP (Proveedor de Servicios de Pago) minorista:

- Apertura de cuentas (CVU/alias) ligadas a un cliente con CUIT.
- Transferencias salientes a CBU/CVU/Alias (red Coelsa simulada).
- Movimientos contables atómicos (débito al ordenante, crédito al beneficiario interno cuando corresponde).
- Comprobantes oficiales por cada operación saliente.
- Panel administrativo separado para back-office (clientes, movimientos, conciliación con BDC).

El motivo del proyecto es **doble**:

1. **Homologación BCRA**: cumplir el contrato técnico que exige el regulador (vía BDC) antes de habilitar cuentas reales.
2. **Producción futura**: dejar la base lista para conmutar de modo *mock* a *live* con BDC sin reescribir la lógica de negocio.

---

## 2. Arquitectura general

```
┌────────────────────────┐         ┌────────────────────────┐
│  securepaynet-app      │         │  bdcconecta-dashboard  │
│  (usuario final)       │         │  (admin / back-office) │
│  React + Vite + TS     │         │  React + Vite + TS     │
│  Tailwind              │         │  Tailwind              │
│  Vercel                │         │  Vercel                │
└────────────┬───────────┘         └────────────┬───────────┘
             │                                  │
             │  Supabase JS SDK (anon/JWT)      │
             ▼                                  ▼
      ┌──────────────────────────────────────────────┐
      │      Supabase (lkqyzyvfcnfzihhlhuru)         │
      │                                              │
      │  • Postgres (RLS activado)                   │
      │  • Auth (email + password)                   │
      │  • Storage (comprobantes PDF, opcional)      │
      │  • Edge Functions (Deno):                    │
      │      - transferencia-execute (service_role)  │
      │      - bdc-proxy (gateway BDC)               │
      └─────────────────┬────────────────────────────┘
                        │
                        ▼ (modo live)
            ┌────────────────────────┐
            │   BDC Conecta API      │
            │   (Banco de Comercio)  │
            └────────────────────────┘
```

### Capas

- **UI (React)**: solo arma el formulario, valida campos básicos y muestra modales/comprobantes.
- **Edge Functions (Deno)**: única vía autorizada para escritura sensible (transferencias, conciliaciones).
- **Postgres + RLS**: capa de seguridad. Los usuarios *jamás* hacen INSERT directo en `transferencias`.
- **BDC Conecta**: integración bancaria real. Hoy mockeada, intercambiable por flag de entorno.

---

## 3. Stack técnico

| Capa            | Tecnología                                     |
|-----------------|------------------------------------------------|
| Frontend        | React 18, Vite, TypeScript, TailwindCSS        |
| State / data    | Zustand (store), Supabase JS v2                |
| Routing         | react-router-dom                               |
| Auth            | Supabase Auth (email + password)               |
| Backend         | Supabase Postgres + Edge Functions (Deno)      |
| Hosting         | Vercel (auto-deploy desde `main`)              |
| Integración bancaria | BDC Conecta API (mock / live)             |

---

## 4. Reglas de negocio generales

Estas reglas son **invariantes** y deben respetarse en cualquier refactor.

### 4.1 Cuentas y clientes
- Todo cliente tiene exactamente **una wallet** (1:1) al momento de homologación.
- **CUIT obligatorio**: NOT NULL, exactamente 11 dígitos numéricos.
- **Saldo inicial**: siempre `0` (no se pueden crear cuentas con saldo precargado).
- **Estado de wallet**: `activa` | `inactiva` | `bloqueada` (CHECK constraint en DB).
- Los usuarios **no pueden crear cuentas a sí mismos**: el alta la hace un admin desde el dashboard.

### 4.2 Transferencias
- Solo **salientes** desde la wallet del usuario autenticado.
- **Monto > 0** (CHECK en DB).
- Requieren: CBU/CVU destino (22 dígitos) + CUIT destino (11 dígitos) + concepto + descripción opcional.
- Se ejecutan **atómicamente** en backend (Edge Function): transferencia + movimiento + comprobante en la misma transacción lógica.
- Si BDC rechaza → la operación **no se persiste** (rollback).

### 4.3 Movimientos
- Tipo: `debito` | `credito` (lowercase, CHECK constraint).
- Cada movimiento guarda `saldo_anterior` y `saldo_posterior` para trazabilidad BCRA.
- Se vinculan a la `transferencia_id` que los originó.

### 4.4 Comprobantes
- Se generan **únicamente** para operaciones **salientes** del usuario.
- **Nunca** se generan para transferencias entrantes (esas figuran como movimiento, no como comprobante propio).
- Numeración automática vía trigger `trg_set_comprobante_numero` con formato `CMP-AAAA-NNNNNN`.
- Visibles en:
  - App usuario: ruta `/comprobantes` (lista) + modal de detalle.
  - Admin: ruta `/movimientos` con botón "📄 Ver" cuando aplica.
- **NO** se exponen en sidebar como sección separada en admin.
- **NO** aparecen en la sección `/clientes` del admin.

### 4.5 Seguridad
- Supabase con **RLS activado** en todas las tablas sensibles.
- `transferencias` **no tiene policy de INSERT** para usuarios → la inserción ocurre por Edge Function con `service_role`.
- `wallets` solo permite lectura propia al usuario; admin tiene policies específicas.
- El `service_role_key` **nunca** se expone al frontend, vive como secret en Edge Functions.

---

## 5. Modelo de datos (resumen)

### `clientes`
| Campo           | Tipo         | Notas                           |
|-----------------|--------------|---------------------------------|
| id              | uuid PK      |                                 |
| auth_user_id    | uuid         | FK a `auth.users`               |
| nombre          | text         |                                 |
| apellido        | text         |                                 |
| email           | text         |                                 |
| cuit            | text         | NOT NULL, 11 dígitos            |
| telefono        | text         |                                 |
| documento       | text         |                                 |

### `wallets`
| Campo        | Tipo            | Notas                                 |
|--------------|-----------------|---------------------------------------|
| id           | uuid PK         |                                       |
| cliente_id   | uuid FK         | → `clientes.id`                       |
| cvu          | text UNIQUE     | 22 dígitos                            |
| alias        | text UNIQUE     |                                       |
| cuit         | text            |                                       |
| titular      | text            |                                       |
| saldo        | numeric         | Default 0                             |
| moneda       | text            | Default 'ARS'                         |
| estado       | text            | CHECK: activa/inactiva/bloqueada      |

### `transferencias`
| Campo               | Tipo      | Notas                                |
|---------------------|-----------|--------------------------------------|
| id                  | uuid PK   |                                      |
| wallet_origen_id    | uuid FK   |                                      |
| wallet_destino_id   | uuid FK   | Nullable (destino externo)           |
| monto               | numeric   | CHECK > 0                            |
| moneda              | text      |                                      |
| descripcion         | text      |                                      |
| referencia          | text      |                                      |
| estado              | text      | pendiente/completada/rechazada       |
| tipo                | text      |                                      |
| origin_id           | text      | ID externo BDC                       |
| from_cvu            | text      |                                      |
| from_cuit           | text      |                                      |
| to_address          | text      | CBU/CVU/Alias destino                |
| to_cuit             | text      |                                      |
| concepto            | text      |                                      |
| coelsa_id           | text      | Trace ID red Coelsa                  |

> **Importante:** `transferencias` **NO tiene** columna `cliente_id`. Se accede por `wallet_origen_id → wallets.cliente_id`.

### `movimientos`
| Campo            | Tipo    | Notas                              |
|------------------|---------|------------------------------------|
| id               | uuid PK |                                    |
| wallet_id        | uuid FK |                                    |
| cvu              | text    |                                    |
| tipo             | text    | CHECK: `debito` \| `credito` (lower)  |
| monto            | numeric | CHECK > 0                          |
| saldo_anterior   | numeric |                                    |
| saldo_posterior  | numeric |                                    |
| descripcion      | text    |                                    |
| estado           | text    |                                    |
| referencia       | text    |                                    |
| transferencia_id | uuid FK |                                    |

### `comprobantes`
| Campo               | Tipo    | Notas                            |
|---------------------|---------|----------------------------------|
| id                  | uuid PK |                                  |
| numero_seq          | int     | Autogen por trigger              |
| numero              | text    | `CMP-AAAA-NNNNNN` autogen        |
| transferencia_id    | uuid FK |                                  |
| wallet_origen_id    | uuid FK |                                  |
| wallet_destino_id   | uuid FK |                                  |
| cliente_id          | uuid FK |                                  |
| titular_origen      | text    |                                  |
| cuit_origen         | text    |                                  |
| cvu_origen          | text    |                                  |
| titular_destino     | text    |                                  |
| cuit_destino        | text    |                                  |
| cvu_destino         | text    |                                  |
| monto               | numeric |                                  |
| moneda              | text    |                                  |
| concepto            | text    |                                  |
| descripcion         | text    |                                  |
| coelsa_id           | text    |                                  |
| origin_id           | text    |                                  |
| saldo_anterior      | numeric |                                  |
| saldo_posterior     | numeric |                                  |
| banco               | text    | "Banco de Comercio"              |
| payload             | jsonb   | Snapshot completo de la op       |

### Triggers relevantes
- `trg_set_comprobante_numero`: completa `numero` a partir de `numero_seq`.
- (Otros triggers operan sobre saldos pero la lógica primaria está en la Edge Function por simplicidad de auditoría).

---

## 6. Edge Functions

### 6.1 `transferencia-execute`
**Endpoint:** `POST https://lkqyzyvfcnfzihhlhuru.supabase.co/functions/v1/transferencia-execute`

**Headers:**
```
Authorization: Bearer <JWT del usuario>
Content-Type: application/json
```

**Body:**
```json
{
  "to_cbu": "0000003100099999999999",
  "to_cuit": "20111222333",
  "monto": 150,
  "concepto": "VAR",
  "descripcion": "Pago factura"
}
```

**Respuesta OK (200):**
```json
{
  "ok": true,
  "transferencia_id": "uuid",
  "movimiento_id": "uuid",
  "comprobante_id": "uuid",
  "numero_comprobante": "CMP-2026-000003",
  "coelsa_id": "MOCK-COELSA-...",
  "saldo_nuevo": 4750
}
```

**Lógica:**
1. Valida JWT con `admin.auth.getUser(token)` (service_role puede validar cualquier JWT del proyecto).
2. Busca wallet del cliente (vía `auth_user_id → clientes.id → wallets`).
3. Valida saldo suficiente.
4. Llama a `callBdcMock()` o `callBdcLive()` según env `BDC_MODE`.
5. INSERT en `transferencias` (estado `completada`).
6. INSERT en `movimientos` (`debito`, con saldo_anterior/posterior).
7. UPDATE saldo en `wallets`.
8. INSERT en `comprobantes` (trigger autogenera `numero`).
9. Devuelve IDs y nuevo saldo.

**Decisiones clave:**
- **Por qué service_role**: `transferencias` no tiene policy INSERT; centralizar la escritura en una función auditable es requisito BCRA.
- **Por qué `admin.auth.getUser`** y no anon client: las nuevas claves Supabase (`sb_publishable_*`) firman JWT que el legacy anon client no valida.

### 6.2 `bdc-proxy`
Gateway HTTP hacia BDC Conecta. Hoy actúa como mock retornando trace IDs sintéticos. Diseñado para sustituirse por llamadas reales sin tocar el frontend.

---

## 7. Reglas generales de la API BDC Conecta

> Resumen funcional. El contrato técnico exacto se documenta aparte en `bdcconecta-dashboard` cuando se active `live`.

### 7.1 Autenticación
- Por **API Key** + token de sesión emitido por BDC.
- Renovación periódica del token; el proxy debe gestionar refresh transparente.

### 7.2 Operaciones soportadas
| Operación              | Método  | Endpoint relativo            | Descripción                         |
|------------------------|---------|------------------------------|-------------------------------------|
| Alta cuenta CVU        | POST    | `/cuentas`                   | Crea CVU asociado a CUIT            |
| Consulta saldo         | GET     | `/cuentas/:cvu/saldo`        |                                      |
| Consulta movimientos   | GET     | `/cuentas/:cvu/movimientos`  |                                      |
| Transferencia saliente | POST    | `/transferencias`            | Iniciar TX a CBU/CVU/Alias          |
| Conciliación batch     | GET     | `/conciliacion?desde=...`    | Lista TX confirmadas red Coelsa     |

### 7.3 Reglas de uso
- **Idempotencia**: cada request lleva un `origin_id` único (UUID v4) generado por SecurePayNet. Reintentar con el mismo `origin_id` no duplica la operación.
- **Trace Coelsa**: toda TX exitosa devuelve un `coelsa_id` que se persiste en `transferencias.coelsa_id` y `comprobantes.coelsa_id`. Es el identificador oficial frente al BCRA.
- **Estados de TX**: `pendiente` → `completada` | `rechazada`. No hay mutaciones laterales.
- **Cutoff horario**: BDC define ventanas; las TX fuera de ventana quedan `pendiente` hasta apertura de la siguiente ventana.
- **Reversos**: solo BDC los origina. SecurePayNet los recibe vía conciliación y crea movimiento de `credito` con descripción "REVERSO TX <id>".
- **Límites**: configurables por cliente desde admin; el chequeo se hace en la Edge Function antes de invocar BDC.

### 7.4 Modos de ejecución
| Modo  | env var          | Descripción                                                       |
|-------|------------------|-------------------------------------------------------------------|
| mock  | `BDC_MODE=mock`  | Simula respuestas BDC con `coelsa_id` sintético `MOCK-COELSA-*`    |
| live  | `BDC_MODE=live`  | Llama a BDC real con API Key del banco                            |

Para activar live, alcanza con setear la env var en Supabase Edge Functions e implementar `callBdcLive()` en `transferencia-execute`. **No se requiere refactor de frontend.**

---

## 8. Estructura de carpetas (frontend)

```
securepaynet-app/
├── src/
│   ├── components/
│   │   └── ComprobanteModal.tsx
│   ├── layouts/
│   │   └── AppLayout.tsx
│   ├── lib/
│   │   └── supabase.ts
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Transferir.tsx       ← llama a Edge Function
│   │   ├── Movimientos.tsx
│   │   └── Comprobantes.tsx
│   ├── services/
│   │   └── bdcService.ts        ← wrapper de bdc-proxy
│   ├── store/
│   │   └── useAuth.ts
│   ├── App.tsx
│   └── main.tsx
└── DOCUMENTACION.md
```

---

## 9. Flujo end-to-end de una transferencia

1. Usuario completa formulario en `/transferir`.
2. Frontend valida formato (CBU 22, CUIT 11, monto > 0).
3. Frontend toma `session.access_token` y hace fetch a `transferencia-execute`.
4. Edge Function valida JWT, busca wallet, valida saldo.
5. Edge Function llama a BDC (mock/live) → obtiene `coelsa_id`.
6. Edge Function inserta `transferencias`, `movimientos`, actualiza `saldo`, inserta `comprobantes`.
7. Edge Function responde con IDs y saldo nuevo.
8. Frontend muestra `ComprobanteModal` con datos retornados.
9. `/comprobantes` lista el nuevo comprobante por consulta a Postgres con RLS (lectura propia).

---

## 10. Lecciones aprendidas (no repetir)

- **CHECK constraint `movimientos.tipo`** acepta solo `debito`/`credito` en **minúsculas**. Si se envía `DEBITO` falla con violación de constraint.
- **`transferencias` no tiene `cliente_id`**: si una migración lo añadió en código pero no en DB, hay que ir por `wallet_origen_id`.
- **Editor web de GitHub autocompleta tags JSX** (`</div>` → `</div>div>`) cuando se *tipea*. Hay que **pegar** con `ClipboardEvent` para evitarlo.
- **Sandbox de Claude bloquea lectura de tokens** en localStorage/DOM por seguridad. Hay que usarlos en la misma ejecución JS donde se leen, sin imprimirlos.
- **JWT firmado por nuevas claves Supabase** (`sb_publishable_*`) no se valida con el anon client legacy: usar `admin.auth.getUser(token)` con service_role.
- **Saldo inicial** debe ser `0` siempre; si se ven cuentas con precarga es un error de seeds, no del flujo.

---

## 11. Convenciones de commits y deploy

- Branch principal: `main`.
- Commits con prefijo: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Vercel auto-deploy en push a `main` (~30 segundos).
- Edge Functions se despliegan desde el dashboard de Supabase ("Via Editor" o CLI).

---

## 12. Variables de entorno

### Frontend (Vercel)
```
VITE_SUPABASE_URL=https://lkqyzyvfcnfzihhlhuru.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

### Edge Functions (Supabase secrets)
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   ← jamás exponer
SUPABASE_ANON_KEY=...
BDC_MODE=mock                    ← o "live"
BDC_API_BASE=https://...         ← solo en live
BDC_API_KEY=...                  ← solo en live, secret
```

---

## 13. Roadmap pendiente

1. Implementar `callBdcLive()` real con autenticación BDC + retries + idempotencia.
2. Conciliación nocturna automática (cron en Edge Function) que llame a `/conciliacion` y cree los `creditos` que correspondan.
3. PDF firmado de comprobante (Storage Supabase + signed URL).
4. Multi-moneda (hoy ARS hardcoded en varios puntos).
5. Auditoría: tabla `audit_log` con todos los eventos sensibles disparada desde Edge Function.
6. Tests E2E automatizados (Playwright) sobre los flujos principales.

---

## 14. Contactos / responsables

- **Repos:** organización `cv-sketch` en GitHub.
- **Supabase project owner:** `cv-sketch's Org`.
- **Hosting:** cuenta Vercel asociada a `cv-sketch`.

---

_Fin del documento._
