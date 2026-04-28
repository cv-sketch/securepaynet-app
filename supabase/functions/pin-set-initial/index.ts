// supabase/functions/pin-set-initial/index.ts
// POST con Bearer JWT. Body: { pin }.
// Establece el PIN inicial del usuario (solo si no existe uno previo).
// Llamado desde el wrapper frontend usado por la pagina de onboarding/PIN setup
// (ver Task 11 del plan).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { hashPin, isValidPinFormat } from '../_shared/pinCrypto.ts'

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
  try {
    const body = await req.json()
    pin = String(body?.pin ?? '')
  } catch {
    return jsonErr(400, 'invalid body')
  }

  if (!isValidPinFormat(pin)) {
    return jsonRaw(400, { error: 'invalid_pin_format' })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: existing, error: selErr } = await admin
    .from('user_security')
    .select('auth_user_id, pin_hash')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (selErr) {
    console.error('[pin-set-initial] select error:', selErr)
    return jsonErr(500, 'lookup failed')
  }

  if (existing?.pin_hash) {
    return jsonRaw(409, { error: 'pin_already_set' })
  }

  const pinHash = await hashPin(pin)
  const nowIso = new Date().toISOString()

  const { error: upErr } = await admin
    .from('user_security')
    .upsert(
      {
        auth_user_id: userId,
        pin_hash: pinHash,
        pin_set_at: nowIso,
        failed_attempts: 0,
        locked_until: null,
        account_locked: false,
      },
      { onConflict: 'auth_user_id' },
    )
  if (upErr) {
    console.error('[pin-set-initial] upsert error:', upErr)
    return jsonErr(500, 'pin set failed')
  }

  await admin.from('pin_security_audit_log').insert({
    auth_user_id: userId,
    event: 'set',
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
