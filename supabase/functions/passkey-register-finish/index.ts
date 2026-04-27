// supabase/functions/passkey-register-finish/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyRegistrationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
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

  const body = (await req.json()) as { credential: unknown; deviceName?: string }
  if (!body.credential) return jsonErr(400, 'credential requerido')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('id, challenge, expires_at')
    .eq('user_id', u.user.id)
    .eq('type', 'register')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ch) return jsonErr(401, 'challenge expirado o inexistente')

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: ch.challenge,
      expectedOrigin: Deno.env.get('WEBAUTHN_ORIGIN')!,
      expectedRPID: Deno.env.get('WEBAUTHN_RP_ID')!,
    })
  } catch (e) {
    return jsonErr(401, `verificacion fallida: ${(e as Error).message}`)
  }
  if (!verification.verified || !verification.registrationInfo) {
    return jsonErr(401, 'verificacion fallida')
  }

  const info = verification.registrationInfo
  const credId = info.credentialID
  const publicKey = info.credentialPublicKey
  const transports =
    (body.credential as { response?: { transports?: string[] } })?.response?.transports ?? []

  const { error: insErr } = await admin.from('user_passkeys').insert({
    user_id: u.user.id,
    credential_id: credId,
    public_key: publicKey,
    counter: info.counter,
    transports,
    device_name: body.deviceName ?? null,
  })
  if (insErr) return jsonErr(500, `insert error: ${insErr.message}`)

  await admin.from('webauthn_challenges').delete().eq('id', ch.id)

  return new Response(JSON.stringify({ ok: true }), {
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
