// supabase/functions/session-heartbeat/index.ts
// POST con Bearer JWT + body { session_id }.
// Si la sesión está vigente: refresca last_activity_at, devuelve segundos restantes.
// Si expiró: la marca revocada con reason='idle'|'absolute', llama auth.admin.signOut, devuelve {expired}.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  let sessionId: string
  try {
    const body = await req.json()
    sessionId = String(body?.session_id ?? '')
  } catch {
    return jsonErr(400, 'invalid body')
  }
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return jsonErr(400, 'invalid session_id')

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

  const { data: session, error: selErr } = await admin
    .from('user_sessions')
    .select('id, user_id, last_activity_at, absolute_expires_at, idle_timeout_seconds, revoked_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (selErr) return jsonErr(500, 'session lookup failed')
  if (!session || session.user_id !== userId) return jsonErr(404, 'session not found')
  if (session.revoked_at) return jsonExpired(401, 'revoked')

  const now = Date.now()
  const lastActivity = new Date(session.last_activity_at).getTime()
  const absoluteExpires = new Date(session.absolute_expires_at).getTime()
  const idleDeadline = lastActivity + session.idle_timeout_seconds * 1000

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  if (now >= absoluteExpires) {
    await expire(admin, session.id, userId, 'absolute', ip, userAgent, authHeader)
    return jsonExpired(401, 'absolute')
  }
  if (now >= idleDeadline) {
    await expire(admin, session.id, userId, 'idle', ip, userAgent, authHeader)
    return jsonExpired(401, 'idle')
  }

  // Sesión vigente: refrescar last_activity_at (sliding session).
  await admin.from('user_sessions').update({ last_activity_at: new Date(now).toISOString() }).eq('id', session.id)
  await admin.from('session_audit_log').insert({
    session_id: session.id,
    user_id: userId,
    event: 'heartbeat',
    ip,
    user_agent: userAgent,
  })

  // Después del refresh el contador idle reinicia a su valor configurado (sliding).
  const idleRemainingAfterRefresh = session.idle_timeout_seconds
  const absoluteRemaining = Math.floor((absoluteExpires - now) / 1000)

  return new Response(
    JSON.stringify({
      ok: true,
      idle_remaining_seconds: idleRemainingAfterRefresh,
      absolute_remaining_seconds: absoluteRemaining,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

async function expire(
  admin: ReturnType<typeof createClient>,
  sessionId: string,
  userId: string,
  reason: 'idle' | 'absolute',
  ip: string | null,
  userAgent: string | null,
  authHeader: string,
) {
  await admin
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq('id', sessionId)
  await admin.from('session_audit_log').insert({
    session_id: sessionId,
    user_id: userId,
    event: reason === 'idle' ? 'expired_idle' : 'expired_absolute',
    ip,
    user_agent: userAgent,
  })
  // Invalida el refresh_token de Supabase para que la próxima refresh falle.
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  try {
    await admin.auth.admin.signOut(jwt, 'global')
  } catch (e) {
    console.error('[session-heartbeat] signOut error:', e)
  }
}

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonExpired(status: number, reason: string): Response {
  return new Response(JSON.stringify({ ok: false, expired: reason }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
