// supabase/functions/pin-verify/index.ts
// POST con Bearer JWT. Body: { pin, scope }.
// Verifica el PIN del usuario y emite un elevation_token (60s) para el scope solicitado.
// Aplica lockout temporal (15min tras 3 fallos) y bloqueo duro tras 5 lockouts.
// Llamado desde el wrapper frontend en flujos que requieren elevacion
// (transfer, add_contact, change_email, change_pin, close_account, export_data).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { isValidPinFormat, verifyPin } from '../_shared/pinCrypto.ts'
import { isCurrentlyLocked, recordFailedAttempt } from '../_shared/pinLockout.ts'
import { type ElevationScope, signElevationToken } from '../_shared/elevationToken.ts'

const VALID_SCOPES: ReadonlySet<ElevationScope> = new Set<ElevationScope>([
  'transfer',
  'add_contact',
  'change_email',
  'change_pin',
  'close_account',
  'export_data',
])

const ELEVATION_TTL_SECONDS = 60

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

  let pin: string
  let scope: string
  try {
    const body = await req.json()
    pin = String(body?.pin ?? '')
    scope = String(body?.scope ?? '')
  } catch {
    return jsonErr(400, 'invalid body')
  }

  if (!isValidPinFormat(pin)) {
    return jsonRaw(400, { ok: false, reason: 'invalid_pin_format' })
  }
  if (!VALID_SCOPES.has(scope as ElevationScope)) {
    return jsonRaw(400, { ok: false, reason: 'invalid_scope' })
  }
  const elevationScope = scope as ElevationScope

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
    console.error('[pin-verify] select error:', selErr)
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

  // Si lockedUntil ya expiro lo limpiaremos en cualquier escritura.
  const ok = await verifyPin(pin, row.pin_hash)

  if (ok) {
    const { error: upErr } = await admin
      .from('user_security')
      .update({
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('auth_user_id', userId)
    if (upErr) {
      console.error('[pin-verify] reset update error:', upErr)
      return jsonErr(500, 'state update failed')
    }

    const secret = Deno.env.get('GATE_TOKEN_SECRET')!
    const elevationToken = await signElevationToken(
      userId,
      elevationScope,
      ELEVATION_TTL_SECONDS,
      secret,
    )

    await admin.from('pin_security_audit_log').insert({
      auth_user_id: userId,
      event: 'verify_ok',
      metadata: { scope: elevationScope },
    })

    return jsonRaw(200, {
      ok: true,
      elevation_token: elevationToken,
      scope: elevationScope,
    })
  }

  // Fallo: aplicar state machine
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
    console.error('[pin-verify] fail update error:', upErr)
    return jsonErr(500, 'state update failed')
  }

  const auditRows: Array<{ event: string; metadata: Record<string, unknown> }> = [
    { event: 'verify_fail', metadata: { scope: elevationScope } },
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
