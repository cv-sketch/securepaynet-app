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
