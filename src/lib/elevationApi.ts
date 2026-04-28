// src/lib/elevationApi.ts
// Wrapper sobre auth-elevate-passkey: corre la ceremonia WebAuthn (begin con
// passkey-auth-begin -> assertion en el authenticator -> finish con
// auth-elevate-passkey con scope) y devuelve un elevation_token.
// Consumido por: useElevation.ts (Task 12), que orquesta passkey-first con
// fallback a PIN modal.
import { supabase } from './supabase'
import { authenticateCredential } from './webauthn'
import type { ElevationScope } from './pinApi'

export type ElevateWithPasskeyResult =
  | { ok: true; elevation_token: string }
  | { ok: false; reason: 'no_passkeys' | 'cancelled' | 'verify_failed' }

function isUserCancel(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return true
  if (err instanceof Error && /cancel|abort|NotAllowed/i.test(err.message)) return true
  return false
}

export async function elevateWithPasskey(scope: ElevationScope): Promise<ElevateWithPasskeyResult> {
  // 1) Pedir challenge (mismo endpoint que login: passkey-auth-begin).
  const { data: begin, error: e1 } = await supabase.functions.invoke('passkey-auth-begin', { body: {} })
  if (e1) return { ok: false, reason: 'verify_failed' }
  if (!begin?.ok) {
    if (begin?.code === 'NO_PASSKEYS') return { ok: false, reason: 'no_passkeys' }
    return { ok: false, reason: 'verify_failed' }
  }

  // 2) Ceremonia WebAuthn (puede arrojar NotAllowedError si el usuario cancela).
  let credential
  try {
    credential = await authenticateCredential(begin.options)
  } catch (err) {
    if (isUserCancel(err)) return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: 'verify_failed' }
  }

  // 3) Finish con scope -> emite elevation_token.
  const { data: finish, error: e2 } = await supabase.functions.invoke('auth-elevate-passkey', {
    body: { scope, credential },
  })
  if (e2 || !finish?.ok) {
    return { ok: false, reason: 'verify_failed' }
  }
  return { ok: true, elevation_token: String(finish.elevation_token) }
}
