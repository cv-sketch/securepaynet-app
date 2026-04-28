// supabase/functions/pin-status/index.ts
// GET con Bearer JWT. Devuelve { pin_set, account_locked, locked_until } para que
// el frontend decida si mostrar setup, modal de PIN, o banner de bloqueo.
// Llamado desde cualquier pagina que necesite consultar el estado del gate de PIN
// (flujos sensibles como transfer, contactos, ajustes) — wrapper en Task 11.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonErr(405, 'method not allowed')
  }

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

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: row, error: selErr } = await admin
    .from('user_security')
    .select('pin_hash, account_locked, locked_until')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (selErr) {
    console.error('[pin-status] select error:', selErr)
    return jsonErr(500, 'lookup failed')
  }

  const pinSet = !!row?.pin_hash
  const accountLocked = !!row?.account_locked
  let lockedUntil: string | null = null
  if (row?.locked_until) {
    const lu = new Date(row.locked_until).getTime()
    if (!Number.isNaN(lu) && lu > Date.now()) {
      lockedUntil = new Date(lu).toISOString()
    }
  }

  return new Response(
    JSON.stringify({
      pin_set: pinSet,
      account_locked: accountLocked,
      locked_until: lockedUntil,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
