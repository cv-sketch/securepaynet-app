// supabase/functions/pin-recovery-reset/index.ts
// POST con Bearer JWT. Body: { new_pin }.
// Reestablece el PIN del usuario (incluso si la cuenta estaba bloqueada por hard-lock).
// Requiere sesion fresca (last_sign_in_at <= 5 min) y un cooldown de 24h entre recoveries.
// Llamado desde el wrapper frontend en la pagina de "Olvide mi PIN" tras re-login.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { hashPin, isValidPinFormat } from '../_shared/pinCrypto.ts'

const FRESH_SESSION_WINDOW_MS = 5 * 60 * 1000
const RECOVERY_COOLDOWN_MS = 24 * 60 * 60 * 1000

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

  let newPin: string
  try {
    const body = await req.json()
    newPin = String(body?.new_pin ?? '')
  } catch {
    return jsonErr(400, 'invalid body')
  }

  if (!isValidPinFormat(newPin)) {
    return jsonRaw(400, { error: 'invalid_pin_format' })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Fresh session check
  const { data: adminUser, error: getUserErr } = await admin.auth.admin.getUserById(userId)
  if (getUserErr || !adminUser?.user) {
    console.error('[pin-recovery-reset] getUserById error:', getUserErr)
    return jsonErr(500, 'user lookup failed')
  }

  const lastSignInAt = adminUser.user.last_sign_in_at
  if (!lastSignInAt) {
    return jsonRaw(403, { error: 'fresh_session_required' })
  }
  const lastSignInMs = new Date(lastSignInAt).getTime()
  if (Number.isNaN(lastSignInMs) || Date.now() - lastSignInMs > FRESH_SESSION_WINDOW_MS) {
    return jsonRaw(403, { error: 'fresh_session_required' })
  }

  // Cooldown check
  const { data: row, error: selErr } = await admin
    .from('user_security')
    .select('auth_user_id, last_recovery_at')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (selErr) {
    console.error('[pin-recovery-reset] select error:', selErr)
    return jsonErr(500, 'lookup failed')
  }

  if (row?.last_recovery_at) {
    const lastRecoveryMs = new Date(row.last_recovery_at).getTime()
    const elapsed = Date.now() - lastRecoveryMs
    if (!Number.isNaN(lastRecoveryMs) && elapsed < RECOVERY_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((RECOVERY_COOLDOWN_MS - elapsed) / 1000)
      return jsonRaw(429, {
        error: 'cooldown_active',
        retry_after: retryAfterSeconds,
      })
    }
  }

  const newHash = await hashPin(newPin)
  const nowIso = new Date().toISOString()

  // Recovery desbloquea la cuenta. NO reseteamos total_lockouts (historial auditable).
  const { error: upErr } = await admin
    .from('user_security')
    .upsert(
      {
        auth_user_id: userId,
        pin_hash: newHash,
        pin_set_at: nowIso,
        failed_attempts: 0,
        locked_until: null,
        account_locked: false,
        last_recovery_at: nowIso,
      },
      { onConflict: 'auth_user_id' },
    )
  if (upErr) {
    console.error('[pin-recovery-reset] upsert error:', upErr)
    return jsonErr(500, 'recovery failed')
  }

  await admin.from('pin_security_audit_log').insert({
    auth_user_id: userId,
    event: 'recovery_completed',
    metadata: {},
  })

  return jsonRaw(200, { ok: true })
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
