// supabase/functions/passkey-login-begin/index.ts
// ANONIMO: recibe { email }, devuelve options de WebAuthn para login.
// Usa email-first (no discoverable credentials) para max compatibilidad.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateAuthenticationOptions } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  let body: { email?: string }
  try { body = await req.json() } catch { return jsonErr(400, 'invalid json') }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return jsonErr(400, 'invalid email')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Buscar user_id por email (admin API)
  const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const user = usersList?.users?.find((u) => u.email?.toLowerCase() === email)

  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = []

  if (user) {
    const { data: passkeys } = await admin
      .from('user_passkeys')
      .select('credential_id, transports')
      .eq('user_id', user.id)
    allowCredentials = (passkeys ?? []).map((p) => ({
      id: p.credential_id,
      transports: (p.transports ?? []) as AuthenticatorTransportFuture[],
    }))
  }

  const options = await generateAuthenticationOptions({
    rpID: Deno.env.get('WEBAUTHN_RP_ID') ?? 'securepaynet-wallet.vercel.app',
    allowCredentials,
    userVerification: 'preferred',
    timeout: 60000,
  })

  // Solo persistimos challenge si user existe (sino el login va a fallar igual al verificar)
  if (user) {
    const { error: insErr } = await admin.from('webauthn_challenges').insert({
      user_id: user.id,
      challenge: options.challenge,
      type: 'login',
    })
    if (insErr) return jsonErr(500, insErr.message)
  }

  return new Response(JSON.stringify({ ok: true, options }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    status: 200,
  })
})

type AuthenticatorTransportFuture = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'smart-card'

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
