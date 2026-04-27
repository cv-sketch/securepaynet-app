import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { mockLookup } from './lookupMock.ts'

Deno.test('mockLookup: alias valido devuelve shape correcto', async () => {
  const r = await mockLookup({ type: 'alias', value: 'juan.perez' })
  if (!r.ok) throw new Error('debio ser ok')
  assertEquals(r.data.cvu_completo.length, 22)
  assertEquals(r.data.cuit.length, 11)
  assertEquals(typeof r.data.nombre, 'string')
  assertEquals(typeof r.data.entidad, 'string')
})

Deno.test('mockLookup: determinista para mismo alias', async () => {
  const a = await mockLookup({ type: 'alias', value: 'juan.perez' })
  const b = await mockLookup({ type: 'alias', value: 'juan.perez' })
  if (!a.ok || !b.ok) throw new Error('ambos deben ser ok')
  assertEquals(a.data.nombre, b.data.nombre)
  assertEquals(a.data.cuit, b.data.cuit)
  assertEquals(a.data.cvu_completo, b.data.cvu_completo)
})

Deno.test('mockLookup: aliases distintos -> resultados distintos', async () => {
  const a = await mockLookup({ type: 'alias', value: 'juan.perez' })
  const b = await mockLookup({ type: 'alias', value: 'maria.gomez' })
  if (!a.ok || !b.ok) throw new Error('ambos deben ser ok')
  assertNotEquals(a.data.cuit, b.data.cuit)
})

Deno.test('mockLookup: CBU formato invalido', async () => {
  const r = await mockLookup({ type: 'cbu', value: '123' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'INVALID_FORMAT')
})

Deno.test('mockLookup: alias formato invalido (con espacios)', async () => {
  const r = await mockLookup({ type: 'alias', value: 'juan perez' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'INVALID_FORMAT')
})

Deno.test('mockLookup: alias muy corto', async () => {
  const r = await mockLookup({ type: 'alias', value: 'juan' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'INVALID_FORMAT')
})

Deno.test('mockLookup: CBU termina en 0000 -> ACCOUNT_DISABLED', async () => {
  const r = await mockLookup({ type: 'cbu', value: '0050003100012345670000' })
  assertEquals(r.ok, false)
  if (!r.ok) assertEquals(r.code, 'ACCOUNT_DISABLED')
})

Deno.test('mockLookup: CBU valido devuelve mismo CBU como cvu_completo', async () => {
  const v = '0070003100012345678901'
  const r = await mockLookup({ type: 'cbu', value: v })
  if (!r.ok) throw new Error('debio ser ok')
  assertEquals(r.data.cvu_completo, v)
})
