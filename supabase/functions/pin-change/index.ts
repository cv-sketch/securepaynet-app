// supabase/functions/pin-change/index.ts
// POST con Bearer JWT. Body: { current_pin, new_pin }.
// Cambia el PIN del usuario tras verificar el actual. Aplica lockout igual que pin-verify.
// Llamado desde el wrapper frontend en la pagina de ajustes "Cambiar PIN".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { hashPin, isValidPinFormat, verifyPin } from '../_shared/pinCrypto.ts'
import { isCurrentlyLocked, recordFailedAttempt } from '../_shared/pinLockout.ts'

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

  let currentPin: string
  let newPin: string
  try {
    const body = await req.json()
    currentPin = String(body?.current_pin ?? '')
    newPin = String(body?.new_pin ?? '')
  } catch {
    return jsonErr(400, 'invalid body')
  }

  if (!isValidPinFormat(currentPin) || !isValidPinFormat(newPin)) {
    return jsonRaw(400, { ok: false, reason: 'invalid_pin_format' })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: row, error: selErr } = await admin
    .from('user_security')
    .select('auth_user_id, pin_hash, failed_attempts, locked_until, total_lockouts, account_locked')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (selErr) {
    console.error('[pin-change] select error:', selErr)
    return jsonErr(500, 'lookup failed')
  }

  if (!row || !row.pin_hash) {
    return jsonRaw(400, { ok: false, reason: 'pin_not_set' })
  }

  if (row.account_locked) {
    return jsonRaw(403, { ok: false, reason: 'account_locked' })
  }

  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null
  const lockState = isCurrentlyLocked(lockedUntil, row.account_locked)
  if (lockState.locked && lockState.reason === 'temporary') {
    return jsonRaw(423, {
      ok: false,
      reason: 'locked',
      locked_until: row.locked_until,
    })
  }

  const ok = await verifyPin(currentPin, row.pin_hash)

  if (ok) {
    const newHash = await hashPin(newPin)
    const nowIso = new Date().toISOString()

    const { error: upErr } = await admin
      .from('user_security')
      .update({
        pin_hash: newHash,
        pin_set_at: nowIso,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('auth_user_id', userId)
    if (upErr) {
      console.error('[pin-change] update error:', upErr)
      return jsonErr(500, 'pin update failed')
    }

    await admin.from('pin_security_audit_log').insert({
      auth_user_id: userId,
      event: 'change',
      metadata: {},
    })

    return jsonRaw(200, { ok: true })
  }

  // Fallo: aplicar state machine identica a pin-verify
  const decision = recordFailedAttempt(
    Number(row.failed_attempts ?? 0),
    Number(row.total_lockouts ?? 0),
  )

  const { error: upErr } = await admin
    .from('user_security')
    .update({
      failed_attempts: decision.newFailedAttempts,
      locked_until: decision.newLockedUntil ? decision.newLockedUntil.toISOString() : null,
      total_lockouts: decision.newTotalLockouts,
      account_locked: decision.accountLocked,
    })
    .eq('auth_user_id', userId)
  if (upErr) {
    console.error('[pin-change] fail update error:', upErr)
    return jsonErr(500, 'state update failed')
  }

  const auditRows: Array<{ event: string; metadata: Record<string, unknown> }> = [
    { event: 'verify_fail', metadata: { context: 'change' } },
  ]
  if (decision.shouldLock && !decision.hardLock) {
    auditRows.push({
      event: 'lockout',
      metadata: { locked_until: decision.newLockedUntil?.toISOString() ?? null },
    })
  }
  if (decision.hardLock) {
    auditRows.push({ event: 'account_lockout', metadata: {} })
  }
  await admin.from('pin_security_audit_log').insert(
    auditRows.map((r) => ({ auth_user_id: userId, event: r.event, metadata: r.metadata })),
  )

  const attemptsRemaining = Math.max(0, 3 - decision.newFailedAttempts)

  const respBody: Record<string, unknown> = {
    ok: false,
    reason: 'invalid_pin',
    attempts_remaining: attemptsRemaining,
  }
  if (decision.newLockedUntil) {
    respBody.locked_until = decision.newLockedUntil.toISOString()
  }
  if (decision.accountLocked) {
    respBody.account_locked = true
  }

  return jsonRaw(401, respBody)
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonRaw(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
