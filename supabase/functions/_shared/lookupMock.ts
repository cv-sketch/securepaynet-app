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
