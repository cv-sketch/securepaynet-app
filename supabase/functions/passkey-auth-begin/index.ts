// supabase/functions/passkey-auth-begin/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateAuthenticationOptions } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return jsonErr(401, 'unauthenticated')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: passkeys } = await admin
    .from('user_passkeys')
    .select('credential_id, transports')
    .eq('user_id', u.user.id)

  if (!passkeys || passkeys.length === 0) {
    return new Response(JSON.stringify({ ok: false, code: 'NO_PASSKEYS' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const options = await generateAuthenticationOptions({
    rpID: Deno.env.get('WEBAUTHN_RP_ID')!,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: passkeys.map((p) => ({
      id: p.credential_id,
      transports: (p.transports ?? []) as AuthenticatorTransportFuture[],
    })),
  })

  await admin.from('webauthn_challenges').insert({
    user_id: u.user.id,
    challenge: options.challenge,
    type: 'auth',
  })

  return new Response(JSON.stringify({ ok: true, options }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})

type AuthenticatorTransportFuture = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'smart-card'

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
