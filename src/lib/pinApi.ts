// src/lib/pinApi.ts
// Wrappers tipados sobre las 5 edge functions de PIN auth.
// Consumido por: PinSetupForm.tsx (setInitialPin/recoveryResetPin),
// PinInputModal flow via useElevation (verifyPin), Seguridad.tsx (changePin, getPinStatus),
// App.tsx post-hydrate guard (getPinStatus), Signup.tsx (setup step).
import { supabase } from './supabase'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('no_jwt')
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  return fetch(`${FN_URL}${path}`, {
    method: init?.method ?? 'POST',
    headers,
    body: init?.body,
  })
}

export type PinStatus = {
  pin_set: boolean
  account_locked: boolean
  locked_until: string | null
}

export type ElevationScope =
  | 'transfer'
  | 'add_contact'
  | 'change_email'
  | 'change_pin'
  | 'close_account'
  | 'export_data'

export async function getPinStatus(): Promise<PinStatus> {
  const r = await authedFetch('/pin-status', { method: 'POST', body: JSON.stringify({}) })
  if (!r.ok) throw new Error(`pin-status failed: ${r.status}`)
  const body = await r.json()
  return {
    pin_set: !!body?.pin_set,
    account_locked: !!body?.account_locked,
    locked_until: body?.locked_until ?? null,
  }
}

export type SetInitialPinResult =
  | { ok: true }
  | { ok: false; error: string }

export async function setInitialPin(pin: string): Promise<SetInitialPinResult> {
  const r = await authedFetch('/pin-set-initial', { body: JSON.stringify({ pin }) })
  const body = await r.json().catch(() => ({}))
  if (r.ok && body?.ok) return { ok: true }
  return { ok: false, error: String(body?.error ?? body?.reason ?? `pin-set-initial failed: ${r.status}`) }
}

export type VerifyPinResult =
  | { ok: true; elevation_token: string; scope: ElevationScope }
  | {
      ok: false
      reason: 'invalid_pin' | 'locked' | 'account_locked' | 'pin_not_set'
      attempts_remaining?: number
      locked_until?: string
    }

export async function verifyPin(pin: string, scope: ElevationScope): Promise<VerifyPinResult> {
  const r = await authedFetch('/pin-verify', { body: JSON.stringify({ pin, scope }) })
  const body = await r.json().catch(() => ({}))
  if (r.ok && body?.ok) {
    return {
      ok: true,
      elevation_token: String(body.elevation_token),
      scope: body.scope as ElevationScope,
    }
  }
  const reason = String(body?.reason ?? 'invalid_pin')
  const allowed = ['invalid_pin', 'locked', 'account_locked', 'pin_not_set'] as const
  type AllowedReason = typeof allowed[number]
  const safeReason: AllowedReason = (allowed as readonly string[]).includes(reason)
    ? (reason as AllowedReason)
    : 'invalid_pin'
  const out: VerifyPinResult = { ok: false, reason: safeReason }
  if (typeof body?.attempts_remaining === 'number') out.attempts_remaining = body.attempts_remaining
  if (typeof body?.locked_until === 'string') out.locked_until = body.locked_until
  return out
}

export type ChangePinResult =
  | { ok: true }
  | { ok: false; reason: string; attempts_remaining?: number; locked_until?: string }

export async function changePin(currentPin: string, newPin: string): Promise<ChangePinResult> {
  const r = await authedFetch('/pin-change', {
    body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
  })
  const body = await r.json().catch(() => ({}))
  if (r.ok && body?.ok) return { ok: true }
  const out: { ok: false; reason: string; attempts_remaining?: number; locked_until?: string } = {
    ok: false,
    reason: String(body?.reason ?? body?.error ?? `pin-change failed: ${r.status}`),
  }
  if (typeof body?.attempts_remaining === 'number') out.attempts_remaining = body.attempts_remaining
  if (typeof body?.locked_until === 'string') out.locked_until = body.locked_until
  return out
}

export type RecoveryResetPinResult =
  | { ok: true }
  | { ok: false; error: string; retry_after?: string }

export async function recoveryResetPin(newPin: string): Promise<RecoveryResetPinResult> {
  const r = await authedFetch('/pin-recovery-reset', { body: JSON.stringify({ new_pin: newPin }) })
  const body = await r.json().catch(() => ({}))
  if (r.ok && body?.ok) return { ok: true }
  const out: { ok: false; error: string; retry_after?: string } = {
    ok: false,
    error: String(body?.error ?? body?.reason ?? `pin-recovery-reset failed: ${r.status}`),
  }
  if (body?.retry_after !== undefined) out.retry_after = String(body.retry_after)
  return out
}
