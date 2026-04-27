// supabase/functions/passkey-register-begin/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateRegistrationOptions } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: existing } = await admin
    .from('user_passkeys')
    .select('credential_id, transports')
    .eq('user_id', u.user.id)

  const options = await generateRegistrationOptions({
    rpName: Deno.env.get('WEBAUTHN_RP_NAME') ?? 'SecurePayNet',
    rpID: Deno.env.get('WEBAUTHN_RP_ID') ?? 'securepaynet-wallet.vercel.app',
    userID: new TextEncoder().encode(u.user.id),
    userName: u.user.email ?? u.user.id,
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  const { error: insErr } = await admin.from('webauthn_challenges').insert({
    user_id: u.user.id,
    challenge: options.challenge,
    type: 'register',
  })
  if (insErr) return jsonErr(500, insErr.message)

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
