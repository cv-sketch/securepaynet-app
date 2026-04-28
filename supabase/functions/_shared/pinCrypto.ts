// supabase/functions/_shared/pinCrypto.ts
// Supabase Edge Runtime does not allow Web Workers, which the bcrypt
// async API spawns. Use the *Sync variants only.
import { compareSync, genSaltSync, hashSync } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

const PIN_REGEX = /^[0-9]{6}$/
const BCRYPT_COST = 10

export function isValidPinFormat(s: string): boolean {
  if (typeof s !== 'string') return false
  return PIN_REGEX.test(s)
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error('invalid_pin_format')
  }
  const salt = genSaltSync(BCRYPT_COST)
  return hashSync(pin, salt)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false
  if (typeof hash !== 'string' || hash.length === 0) return false
  try {
    return compareSync(pin, hash)
  } catch {
    return false
  }
}
