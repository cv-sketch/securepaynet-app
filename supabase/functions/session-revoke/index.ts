// supabase/functions/session-revoke/index.ts
// POST con Bearer JWT + body { session_id, reason? }.
// Marca la sesión revocada (default reason='user'), invalida refresh_token,
// registra evento en audit log.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  let sessionId: string
  let reason: string
  try {
    const body = await req.json()
    sessionId = String(body?.session_id ?? '')
    reason = String(body?.reason ?? 'user')
  } catch {
    return jsonErr(400, 'invalid body')
  }
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return jsonErr(400, 'invalid session_id')
  if (!['user', 'forced_admin', 'password_changed'].includes(reason)) {
    return jsonErr(400, 'invalid reason')
  }

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

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  const { data: session } = await admin
    .from('user_sessions')
    .select('id, user_id, revoked_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session || session.user_id !== userId) return jsonErr(404, 'session not found')

  if (!session.revoked_at) {
    await admin
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
      .eq('id', session.id)
  }

  await admin.from('session_audit_log').insert({
    session_id: session.id,
    user_id: userId,
    event: reason === 'user' ? 'user_logout' : reason === 'forced_admin' ? 'forced_admin' : 'password_changed',
    ip,
    user_agent: userAgent,
  })

  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  try {
    await admin.auth.admin.signOut(jwt, 'global')
  } catch (e) {
    console.error('[session-revoke] signOut error:', e)
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
