// supabase/functions/_shared/gateToken_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { signGateToken, verifyGateToken } from './gateToken.ts'

const SECRET = 'test-secret-32-bytes-min-aaaaaaaaaaaa'
const USER = '11111111-1111-1111-1111-111111111111'

Deno.test('signGateToken + verifyGateToken: round-trip OK', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  const ok = await verifyGateToken(token, USER, SECRET)
  assertEquals(ok, true)
})

Deno.test('verifyGateToken: tampered payload -> false', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  const [, sig] = token.split('.')
  const fakePayload = btoa(JSON.stringify({ user_id: USER, exp_unix: Date.now() / 1000 + 999999 }))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  const tampered = `${fakePayload}.${sig}`
  assertEquals(await verifyGateToken(tampered, USER, SECRET), false)
})

Deno.test('verifyGateToken: secreto incorrecto -> false', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  assertEquals(await verifyGateToken(token, USER, 'otro-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaa'), false)
})

Deno.test('verifyGateToken: user mismatch -> false', async () => {
  const token = await signGateToken(USER, 60, SECRET)
  const otroUser = '22222222-2222-2222-2222-222222222222'
  assertEquals(await verifyGateToken(token, otroUser, SECRET), false)
})

Deno.test('verifyGateToken: token expirado -> false', async () => {
  const token = await signGateToken(USER, -10, SECRET) // ya expirado
  assertEquals(await verifyGateToken(token, USER, SECRET), false)
})
