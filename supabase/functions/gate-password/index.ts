// supabase/functions/gate-password/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { signGateToken } from '../_shared/gateToken.ts'

const MAX_FAILS_PER_WINDOW = 5
const WINDOW_MINUTES = 10
const BLOCK_MINUTES = 15

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user || !u.user.email) return jsonErr(401, 'unauthenticated')

  const body = (await req.json()) as { password?: string }
  if (!body.password) return jsonErr(400, 'password requerido')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Rate limit
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { data: fails } = await admin
    .from('gate_password_attempts')
    .select('id, created_at')
    .eq('user_id', u.user.id)
    .eq('success', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (fails && fails.length >= MAX_FAILS_PER_WINDOW) {
    const oldest = fails[fails.length - 1]
    const blockUntil = new Date(new Date(oldest.created_at).getTime() + BLOCK_MINUTES * 60_000)
    if (new Date() < blockUntil) {
      return new Response(JSON.stringify({
        ok: false, code: 'RATE_LIMITED',
        message: `Demasiados intentos. Intenta de nuevo despues de ${blockUntil.toISOString()}`,
      }), { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
    }
  }

  // Verificar password con cliente separado (no afecta sesion del browser)
  const verifier = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: signinErr } = await verifier.auth.signInWithPassword({
    email: u.user.email,
    password: body.password,
  })
  await admin.from('gate_password_attempts').insert({ user_id: u.user.id, success: !signinErr })

  if (signinErr) return jsonErr(401, 'Contrasena incorrecta')

  const gateToken = await signGateToken(u.user.id, 60, Deno.env.get('GATE_TOKEN_SECRET')!)
  return new Response(JSON.stringify({ ok: true, gateToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
