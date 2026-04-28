// supabase/functions/session-create/index.ts
// POST con Bearer JWT del usuario. Crea fila en user_sessions y devuelve session_id.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveSessionConfig } from '../_shared/sessionConfig.ts'

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

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: cli } = await admin
    .from('clientes')
    .select('tipo')
    .eq('auth_user_id', userId)
    .maybeSingle()
  const role = cli?.tipo === 'admin' || cli?.tipo === 'compliance' || cli?.tipo === 'soporte'
    ? cli.tipo
    : 'standard'

  const cfg = resolveSessionConfig(role, Deno.env.toObject())

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  const absoluteExpiresAt = new Date(Date.now() + cfg.absoluteSeconds * 1000).toISOString()

  const { data: session, error: insErr } = await admin
    .from('user_sessions')
    .insert({
      user_id: userId,
      absolute_expires_at: absoluteExpiresAt,
      idle_timeout_seconds: cfg.idleSeconds,
      role,
      ip,
      user_agent: userAgent,
    })
    .select('id')
    .single()
  if (insErr || !session) {
    console.error('[session-create] insert error:', insErr)
    return jsonErr(500, 'session create failed')
  }

  await admin.from('session_audit_log').insert({
    session_id: session.id,
    user_id: userId,
    event: 'created',
    ip,
    user_agent: userAgent,
  })

  return new Response(
    JSON.stringify({
      session_id: session.id,
      idle_remaining_seconds: cfg.idleSeconds,
      absolute_remaining_seconds: cfg.absoluteSeconds,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
