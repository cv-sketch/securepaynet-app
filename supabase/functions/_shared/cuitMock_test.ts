import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cuitMock } from './cuitMock.ts'
import { cuitCheckDigit } from './cuit.ts'

const SAMPLE_UID = '11111111-2222-3333-4444-555555555555'

Deno.test('cuitMock empieza con prefijo 20 (persona fisica)', async () => {
  const c = await cuitMock(SAMPLE_UID, 0)
  assertEquals(c.startsWith('20'), true)
  assertEquals(c.length, 11)
})

Deno.test('cuitMock tiene digito verificador correcto', async () => {
  const c = await cuitMock(SAMPLE_UID, 0)
  const base = c.slice(0, 10)
  const expectedDigit = cuitCheckDigit(base)
  assertEquals(c, base + String(expectedDigit))
})

Deno.test('cuitMock es deterministico para mismo uid+attempt', async () => {
  const a = await cuitMock(SAMPLE_UID, 0)
  const b = await cuitMock(SAMPLE_UID, 0)
  assertEquals(a, b)
})

Deno.test('cuitMock con attempt distinto da CUIT distinto', async () => {
  const a = await cuitMock(SAMPLE_UID, 0)
  const b = await cuitMock(SAMPLE_UID, 1)
  assertNotEquals(a, b)
})

Deno.test('cuitMock con uid distinto da CUIT distinto', async () => {
  const a = await cuitMock('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 0)
  const b = await cuitMock('11111111-2222-3333-4444-555555555555', 0)
  assertNotEquals(a, b)
})
