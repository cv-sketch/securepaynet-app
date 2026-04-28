// supabase/functions/onboarding-complete/index.ts
// POST con Bearer JWT del usuario recien creado + body { cuit }.
// Crea clientes + wallets con stubs si no existen. Idempotente.
// El CUIT lo provee el usuario en signup (no se genera automaticamente).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { cuitCheckDigit } from '../_shared/cuit.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

  // Parse body para CUIT
  let bodyCuit: string
  try {
    const body = await req.json()
    bodyCuit = String(body?.cuit ?? '').replace(/\D/g, '')
  } catch {
    return jsonErr(400, 'invalid body')
  }
  if (!/^\d{11}$/.test(bodyCuit)) {
    return jsonErr(400, 'CUIT debe tener 11 digitos')
  }
  const expectedDV = cuitCheckDigit(bodyCuit.slice(0, 10))
  if (parseInt(bodyCuit[10], 10) !== expectedDV) {
    return jsonErr(400, 'CUIT invalido (digito verificador no coincide)')
  }

  // Validar JWT del usuario
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u.user) return jsonErr(401, 'unauthenticated')

  const authUid = u.user.id
  const email = u.user.email
  if (!email) return jsonErr(400, 'user has no email')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Step 1: cliente ya existe?
  const { data: existing, error: selErr } = await admin
    .from('clientes')
    .select('id, cuit')
    .eq('auth_user_id', authUid)
    .maybeSingle()
  if (selErr) return jsonErr(500, selErr.message)

  let clienteId: string
  let effectiveCuit: string
  let created = false

  if (existing) {
    clienteId = existing.id
    // Conservamos el cuit del cliente existente. Ignoramos el input
    // del usuario para no permitir cambio de identidad post-creacion.
    effectiveCuit = existing.cuit ?? bodyCuit
  } else {
    // Crear cliente con el cuit provisto por el usuario
    const localPart = email.split('@')[0].slice(0, 50)
    const { data, error } = await admin
      .from('clientes')
      .insert({
        auth_user_id: authUid,
        email,
        nombre: localPart,
        apellido: 'Test',
        cuit: bodyCuit,
        tipo: 'persona_fisica',
      })
      .select('id')
      .maybeSingle()

    if (error) {
      // Race en auth_user_id (otro request del mismo user creo el cliente)
      if (error.message?.includes('clientes_auth_user_id_unique') || error.message?.includes('auth_user_id')) {
        const { data: race } = await admin
          .from('clientes').select('id, cuit').eq('auth_user_id', authUid).maybeSingle()
        if (race) {
          clienteId = race.id
          effectiveCuit = race.cuit ?? bodyCuit
        } else {
          return jsonErr(500, `cliente lookup failed after race: ${error.message}`)
        }
      } else if (error.code === '23505' || error.message?.toLowerCase().includes('cuit')) {
        return jsonErr(409, 'Ya existe una cuenta con ese CUIT')
      } else {
        return jsonErr(500, `cliente insert failed: ${error.message}`)
      }
    } else {
      if (!data) return jsonErr(500, 'cliente insert returned no data')
      clienteId = data.id
      effectiveCuit = bodyCuit
      created = true
    }
  }

  // Step 2: wallet ya existe?
  const { data: existingWallet } = await admin
    .from('wallets')
    .select('cvu, alias, saldo, moneda')
    .eq('cliente_id', clienteId)
    .maybeSingle()

  let wallet = existingWallet
  if (!wallet) {
    // Crear wallet con stub. cuit denormalizado = clientes.cuit.
    const cvu = await mockCvu(authUid)
    const alias = `test.${clienteId.replace(/-/g, '').slice(0, 8)}.spn`
    const { data: insWallet, error: insWalletErr } = await admin
      .from('wallets')
      .insert({
        cliente_id: clienteId,
        cuit: effectiveCuit,
        saldo: 5000,
        moneda: 'ARS',
        cvu,
        alias,
      })
      .select('cvu, alias, saldo, moneda')
      .maybeSingle()
    if (insWalletErr) {
      const { data: race } = await admin
        .from('wallets').select('cvu, alias, saldo, moneda').eq('cliente_id', clienteId).maybeSingle()
      if (race) wallet = race
      else return jsonErr(500, `wallet insert failed: ${insWalletErr.message}`)
    } else {
      wallet = insWallet
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    cliente_id: clienteId,
    wallet,
    created,
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    status: 200,
  })
})

async function mockCvu(authUid: string): Promise<string> {
  const data = new TextEncoder().encode(`cvu|${authUid}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let n = 0n
  for (let i = 0; i < 8; i++) n = n * 256n + BigInt(bytes[i])
  const fifteenDigits = (n % 1000000000000000n).toString().padStart(15, '0')
  return '0000003' + fifteenDigits
}

function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
