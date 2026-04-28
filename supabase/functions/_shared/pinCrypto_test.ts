// supabase/functions/_shared/pinCrypto_test.ts
import { assertEquals, assertNotEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hashPin, isValidPinFormat, verifyPin } from './pinCrypto.ts'

Deno.test('isValidPinFormat: 6 digitos exactos -> true', () => {
  assertEquals(isValidPinFormat('123456'), true)
  assertEquals(isValidPinFormat('000000'), true)
  assertEquals(isValidPinFormat('999999'), true)
})

Deno.test('isValidPinFormat: 5 digitos -> false', () => {
  assertEquals(isValidPinFormat('12345'), false)
})

Deno.test('isValidPinFormat: 7 digitos -> false', () => {
  assertEquals(isValidPinFormat('1234567'), false)
})

Deno.test('isValidPinFormat: contiene letra -> false', () => {
  assertEquals(isValidPinFormat('12345a'), false)
})

Deno.test('isValidPinFormat: con whitespace -> false', () => {
  assertEquals(isValidPinFormat(' 123456'), false)
  assertEquals(isValidPinFormat('123456 '), false)
  assertEquals(isValidPinFormat('123 56'), false)
})

Deno.test('isValidPinFormat: vacio -> false', () => {
  assertEquals(isValidPinFormat(''), false)
})

Deno.test('hashPin: throws en formato invalido', async () => {
  await assertRejects(() => hashPin('12345'), Error)
  await assertRejects(() => hashPin('abcdef'), Error)
  await assertRejects(() => hashPin(''), Error)
})

Deno.test('hashPin: produce hashes distintos para mismo PIN (salt)', async () => {
  const h1 = await hashPin('123456')
  const h2 = await hashPin('123456')
  assertNotEquals(h1, h2)
})

Deno.test('verifyPin: PIN correcto matchea su hash', async () => {
  const h = await hashPin('654321')
  assertEquals(await verifyPin('654321', h), true)
})

Deno.test('verifyPin: PIN incorrecto no matchea', async () => {
  const h = await hashPin('654321')
  assertEquals(await verifyPin('111111', h), false)
})

Deno.test('verifyPin: formato invalido -> false (no throw)', async () => {
  const h = await hashPin('654321')
  assertEquals(await verifyPin('12345', h), false)
  assertEquals(await verifyPin('abcdef', h), false)
  assertEquals(await verifyPin('', h), false)
})
