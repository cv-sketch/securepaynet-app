// supabase/functions/_shared/elevationToken_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  type ElevationScope,
  signElevationToken,
  verifyElevationToken,
} from './elevationToken.ts'

const SECRET = 'test-secret-32-bytes-min-aaaaaaaaaaaa'
const USER = '11111111-1111-1111-1111-111111111111'
const OTHER_USER = '22222222-2222-2222-2222-222222222222'

const ALL_SCOPES: ElevationScope[] = [
  'transfer',
  'add_contact',
  'change_email',
  'change_pin',
  'close_account',
  'export_data',
]

for (const scope of ALL_SCOPES) {
  Deno.test(`signElevationToken + verifyElevationToken: round-trip OK [${scope}]`, async () => {
    const token = await signElevationToken(USER, scope, 60, SECRET)
    const ok = await verifyElevationToken(token, USER, scope, SECRET)
    assertEquals(ok, true)
  })
}

Deno.test('verifyElevationToken: scope incorrecto -> false', async () => {
  const token = await signElevationToken(USER, 'transfer', 60, SECRET)
  assertEquals(await verifyElevationToken(token, USER, 'add_contact', SECRET), false)
})

Deno.test('verifyElevationToken: payload tampered -> false', async () => {
  const token = await signElevationToken(USER, 'transfer', 60, SECRET)
  const [, sig] = token.split('.')
  const fakePayload = btoa(
    JSON.stringify({
      user_id: USER,
      scope: 'transfer',
      exp_unix: Math.floor(Date.now() / 1000) + 999999,
      jti: 'fake-jti',
    })
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const tampered = `${fakePayload}.${sig}`
  assertEquals(await verifyElevationToken(tampered, USER, 'transfer', SECRET), false)
})

Deno.test('verifyElevationToken: token expirado -> false', async () => {
  const token = await signElevationToken(USER, 'transfer', 0, SECRET)
  await new Promise((r) => setTimeout(r, 1100))
  assertEquals(await verifyElevationToken(token, USER, 'transfer', SECRET), false)
})

Deno.test('verifyElevationToken: user incorrecto -> false', async () => {
  const token = await signElevationToken(USER, 'transfer', 60, SECRET)
  assertEquals(await verifyElevationToken(token, OTHER_USER, 'transfer', SECRET), false)
})

Deno.test('verifyElevationToken: secret incorrecto -> false', async () => {
  const token = await signElevationToken(USER, 'transfer', 60, SECRET)
  assertEquals(
    await verifyElevationToken(token, USER, 'transfer', 'otro-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    false
  )
})

Deno.test('verifyElevationToken: token malformado -> false', async () => {
  assertEquals(await verifyElevationToken('not-a-token', USER, 'transfer', SECRET), false)
  assertEquals(await verifyElevationToken('a.b.c', USER, 'transfer', SECRET), false)
  assertEquals(await verifyElevationToken('', USER, 'transfer', SECRET), false)
})
