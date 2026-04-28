// supabase/functions/auth-elevate-passkey/index.ts
// POST con Bearer JWT. Body: { scope, credential }.
// Verifica una assertion WebAuthn contra un challenge tipo 'auth' y emite un
// elevation_token (60s) para el scope solicitado. Mismo flujo de begin que el
// login con passkey: el cliente primero llama a passkey-auth-begin para obtener
// el challenge, hace la ceremonia con el authenticator, y luego envia el credential
// a esta funcion con el scope deseado.
// Llamado desde el wrapper frontend en flujos de elevacion donde el usuario prefiere
// passkey sobre PIN.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { verifyAuthenticationResponse } from 'https://esm.sh/@simplewebauthn/server@10.0.1'
import { corsHeaders } from '../_shared/cors.ts'
import { type ElevationScope, signElevationToken } from '../_shared/elevationToken.ts'

const VALID_SCOPES: ReadonlySet<ElevationScope> = new Set<ElevationScope>([
  'transfer',
  'add_contact',
  'change_email',
  'change_pin',
  'close_account',
  'export_data',
])

const ELEVATION_TTL_SECONDS = 60

type AuthenticatorTransportFuture = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'smart-card'

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

  let scope: string
  let credential: { id: string; [k: string]: unknown }
  try {
    const body = await req.json()
    scope = String(body?.scope ?? '')
    credential = body?.credential as { id: string; [k: string]: unknown }
  } catch {
    return jsonErr(400, 'invalid body')
  }

  if (!VALID_SCOPES.has(scope as ElevationScope)) {
    return jsonRaw(400, { ok: false, reason: 'invalid_scope' })
  }
  if (!credential?.id) {
    return jsonRaw(400, { ok: false, reason: 'credential_required' })
  }
  const elevationScope = scope as ElevationScope

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('id, challenge')
    .eq('user_id', userId)
    .eq('type', 'auth')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ch) {
    return jsonRaw(401, { ok: false, reason: 'challenge_expired' })
  }

  const { data: pk } = await admin
    .from('user_passkeys')
    .select('id, credential_id, public_key, counter, transports')
    .eq('credential_id', credential.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!pk) {
    return jsonRaw(401, { ok: false, reason: 'passkey_not_registered' })
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: credential as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
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
    console.error('[auth-elevate-passkey] verification error:', e)
    return jsonRaw(401, { ok: false, reason: 'passkey_verify_failed' })
  }

  if (!verification.verified) {
    return jsonRaw(401, { ok: false, reason: 'passkey_verify_failed' })
  }

  const newCounter = verification.authenticationInfo.newCounter
  const { data: updated, error: updErr } = await admin
    .from('user_passkeys')
    .update({ counter: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', pk.id)
    .lt('counter', newCounter)
    .select('id')
    .maybeSingle()
  if (updErr) {
    console.error('[auth-elevate-passkey] counter update error:', updErr)
    return jsonErr(500, 'counter update failed')
  }

  // Si counter no avanzo y newCounter > 0 podria ser clonacion.
  if (!updated && newCounter > 0) {
    return jsonRaw(401, { ok: false, reason: 'cloned_credential' })
  }

  // Consumir challenge
  await admin.from('webauthn_challenges').delete().eq('id', ch.id)

  const secret = Deno.env.get('GATE_TOKEN_SECRET')!
  const elevationToken = await signElevationToken(
    userId,
    elevationScope,
    ELEVATION_TTL_SECONDS,
    secret,
  )

  return jsonRaw(200, {
    ok: true,
    elevation_token: elevationToken,
    scope: elevationScope,
  })
})

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonRaw(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
