// supabase/functions/onboarding-complete/index.ts
// POST con Bearer JWT del usuario recien creado.
// Crea clientes + wallets con stubs si no existen. Idempotente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from '../_shared/cors.ts'
import { cuitMock } from '../_shared/cuitMock.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonErr(405, 'method not allowed')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonErr(401, 'unauthenticated')

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
    .select('id')
    .eq('auth_user_id', authUid)
    .maybeSingle()
  if (selErr) return jsonErr(500, selErr.message)

  let clienteId: string
  let created = false

  if (existing) {
    clienteId = existing.id
  } else {
    // Crear cliente con retry de CUIT
    const localPart = email.split('@')[0].slice(0, 50)
    let inserted: { id: string } | null = null
    let lastErr: Error | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const cuit = await cuitMock(authUid, attempt)
      const { data, error } = await admin
        .from('clientes')
        .insert({
          auth_user_id: authUid,
          email,
          nombre: localPart,
          apellido: 'Test',
          cuit,
          tipo: 'persona_fisica',
        })
        .select('id')
        .maybeSingle()
      if (data) {
        inserted = data
        break
      }
      lastErr = error ? new Error(error.message) : null
      // Si fue UNIQUE violation por auth_user_id (otro proceso lo creo), buscar y salir
      if (error?.message?.includes('clientes_auth_user_id_unique')) {
        const { data: race } = await admin
          .from('clientes').select('id').eq('auth_user_id', authUid).maybeSingle()
        if (race) {
          inserted = race
          break
        }
      }
      // Si fue UNIQUE en cuit, retry con attempt+1
      if (error?.message?.includes('cuit') || error?.code === '23505') continue
      // Otro error: abortar
      return jsonErr(500, `cliente insert failed: ${error?.message}`)
    }
    if (!inserted) return jsonErr(500, `cliente insert failed after retries: ${lastErr?.message}`)
    clienteId = inserted.id
    created = true
  }

  // Step 2: wallet ya existe?
  const { data: existingWallet } = await admin
    .from('wallets')
    .select('cvu, alias, saldo, moneda')
    .eq('cliente_id', clienteId)
    .maybeSingle()

  let wallet = existingWallet
  if (!wallet) {
    // Crear wallet con stub
    const cvu = await mockCvu(authUid)
    const alias = `test.${clienteId.replace(/-/g, '').slice(0, 8)}.spn`
    const { data: insWallet, error: insWalletErr } = await admin
      .from('wallets')
      .insert({
        cliente_id: clienteId,
        saldo: 5000,
        moneda: 'ARS',
        cvu,
        alias,
      })
      .select('cvu, alias, saldo, moneda')
      .maybeSingle()
    if (insWalletErr) {
      // Si race condition, leer el existente
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
  // Formato CVU: 22 digitos. Prefijo '0000003' (mock) + 15 digitos derivados.
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
