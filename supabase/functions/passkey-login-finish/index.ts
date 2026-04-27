// supabase/functions/passkey-login-finish/index.ts
// ANONIMO: verifica WebAuthn assertion, emite hashed_token magiclink.
// El front consume con verifyOtp({ token_hash, type: 'magiclink' }).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyAuthenticationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  let body: { email?: string; credential?: any }
  try { body = await req.json() } catch { return jsonErr(400, 'invalid json') }
  const email = (body.email ?? '').trim().toLowerCase()
  const credential = body.credential
  if (!email || !email.includes('@')) return jsonErr(400, 'invalid email')
  if (!credential || typeof credential !== 'object') return jsonErr(400, 'invalid credential')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Resolver user_id por email
  const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const user = usersList?.users?.find((u) => u.email?.toLowerCase() === email)
  if (!user) return jsonErr(401, 'auth failed')

  // 2. Levantar challenge mas reciente
  const { data: challenge } = await admin
    .from('webauthn_challenges')
    .select('id, challenge, created_at')
    .eq('user_id', user.id)
    .eq('type', 'login')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!challenge) return jsonErr(401, 'no pending challenge')
  // Expirar a 5 min
  const ageMs = Date.now() - new Date(challenge.created_at).getTime()
  if (ageMs > 5 * 60 * 1000) return jsonErr(401, 'challenge expired')

  // 3. Levantar passkey por credential_id
  const { data: passkey } = await admin
    .from('user_passkeys')
    .select('id, credential_id, public_key, counter, transports')
    .eq('user_id', user.id)
    .eq('credential_id', credential.id)
    .maybeSingle()
  if (!passkey) return jsonErr(401, 'auth failed')

  // 4. Verificar assertion
  let result
  try {
    result = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: Deno.env.get('WEBAUTHN_ORIGIN') ?? 'https://securepaynet-wallet.vercel.app',
      expectedRPID: Deno.env.get('WEBAUTHN_RP_ID') ?? 'securepaynet-wallet.vercel.app',
      authenticator: {
        credentialID: passkey.credential_id,
        credentialPublicKey: passkey.public_key,
        counter: Number(passkey.counter),
        transports: passkey.transports as any,
      },
    })
  } catch (err) {
    return jsonErr(401, `verify failed: ${(err as Error).message}`)
  }
  if (!result.verified) return jsonErr(401, 'auth failed')

  const newCounter = result.authenticationInfo.newCounter
  if (newCounter <= Number(passkey.counter)) {
    return new Response(JSON.stringify({ ok: false, code: 'CLONED_CREDENTIAL', message: 'counter regression' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  // 5. UPDATE counter + last_used_at
  await admin
    .from('user_passkeys')
    .update({ counter: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', passkey.id)

  // 6. DELETE challenge (single-use)
  await admin.from('webauthn_challenges').delete().eq('id', challenge.id)

  // 7. Generar magiclink
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr || !link?.properties?.hashed_token) {
    return jsonErr(500, `magiclink generation failed: ${linkErr?.message ?? 'unknown'}`)
  }

  return new Response(JSON.stringify({
    ok: true,
    hashed_token: link.properties.hashed_token,
    type: 'magiclink',
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    status: 200,
  })
})

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
