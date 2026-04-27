import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { entidadByPrefix } from './entidades.ts'

Deno.test('entidadByPrefix: CVU PSP - Mercado Pago', () => {
  assertEquals(entidadByPrefix('0000003100012345678901'), 'Mercado Pago')
})

Deno.test('entidadByPrefix: CVU PSP - Ualá', () => {
  assertEquals(entidadByPrefix('0000054100012345678901'), 'Ualá')
})

Deno.test('entidadByPrefix: CBU bancario - Galicia 005', () => {
  assertEquals(entidadByPrefix('0050003100012345678901'), 'Banco Galicia')
})

Deno.test('entidadByPrefix: CBU bancario - Galicia 007', () => {
  assertEquals(entidadByPrefix('0070003100012345678901'), 'Banco Galicia')
})

Deno.test('entidadByPrefix: CBU bancario - Santander 072', () => {
  assertEquals(entidadByPrefix('0720003100012345678901'), 'Santander')
})

Deno.test('entidadByPrefix: CBU desconocido cae a Otra entidad', () => {
  assertEquals(entidadByPrefix('9990003100012345678901'), 'Otra entidad')
})

Deno.test('entidadByPrefix: CVU prefix desconocido cae a CBU prefix', () => {
  // 0000999 no esta en CVU map; cae al lookup CBU '000' que tampoco esta
  assertEquals(entidadByPrefix('0000999100012345678901'), 'Otra entidad')
})
