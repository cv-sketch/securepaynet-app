// supabase/functions/passkey-auth-finish/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyAuthenticationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'
import { signGateToken } from '../_shared/gateToken.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return jsonErr(401, 'unauthenticated')

  const body = (await req.json()) as { credential: { id: string; [k: string]: unknown } }
  if (!body.credential?.id) return jsonErr(400, 'credential requerido')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('id, challenge')
    .eq('user_id', u.user.id)
    .eq('type', 'auth')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ch) return jsonErr(401, 'challenge expirado o inexistente')

  const { data: pk } = await admin
    .from('user_passkeys')
    .select('id, credential_id, public_key, counter, transports')
    .eq('credential_id', body.credential.id)
    .eq('user_id', u.user.id)
    .maybeSingle()
  if (!pk) return jsonErr(401, 'credencial no registrada para este usuario')

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: ch.challenge,
      expectedOrigin: Deno.env.get('WEBAUTHN_ORIGIN')!,
      expectedRPID: Deno.env.get('WEBAUTHN_RP_ID')!,
      authenticator: {
        credentialID: pk.credential_id,
        credentialPublicKey: new Uint8Array(pk.public_key),
        counter: Number(pk.counter),
        transports: (pk.transports ?? []) as AuthenticatorTransportFuture[],
      },
    })
  } catch (e) {
    return jsonErr(401, `verificacion fallida: ${(e as Error).message}`)
  }

  if (!verification.verified) return jsonErr(401, 'verificacion fallida')

  const newCounter = verification.authenticationInfo.newCounter
  const { data: updated, error: updErr } = await admin
    .from('user_passkeys')
    .update({ counter: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', pk.id)
    .lt('counter', newCounter)
    .select('id')
    .maybeSingle()
  if (updErr) return jsonErr(500, updErr.message)

  // Si counter no avanzo, podria ser clonacion (o newCounter=0 que algunos authenticators usan).
  if (!updated && newCounter > 0) {
    return new Response(JSON.stringify({ ok: false, code: 'CLONED_CREDENTIAL', message: 'Posible clonacion detectada' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  await admin.from('webauthn_challenges').delete().eq('id', ch.id)

  const secret = Deno.env.get('GATE_TOKEN_SECRET')!
  const gateToken = await signGateToken(u.user.id, 60, secret)

  return new Response(JSON.stringify({ ok: true, gateToken }), {
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
