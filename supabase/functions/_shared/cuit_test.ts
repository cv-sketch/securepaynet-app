import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cuitCheckDigit, buildCuit } from './cuit.ts'

// Casos calculados manualmente con la formula BCRA estandar.
// Factores 5,4,3,2,7,6,5,4,3,2 sobre los 10 primeros digitos.
// Para 3071234567: 3*5+0*4+7*3+1*2+2*7+3*6+4*5+5*4+6*3+7*2
//   = 15+0+21+2+14+18+20+20+18+14 = 142; 142 % 11 = 10; 11-10 = 1.
Deno.test('cuitCheckDigit: 30-71234567 -> 1', () => {
  assertEquals(cuitCheckDigit('3071234567'), 1)
})

Deno.test('cuitCheckDigit: 20-12345678 -> 6', () => {
  // 2*5 + 0*4 + 1*3 + 2*2 + 3*7 + 4*6 + 5*5 + 6*4 + 7*3 + 8*2
  // = 10+0+3+4+21+24+25+24+21+16 = 148; 148 % 11 = 5; 11-5 = 6.
  assertEquals(cuitCheckDigit('2012345678'), 6)
})

Deno.test('buildCuit: prefix 20 + 8 digitos', () => {
  const cuit = buildCuit(20, '12345678')
  assertEquals(cuit.length, 11)
  assertEquals(cuit.substring(0, 2), '20')
  assertEquals(cuit.substring(2, 10), '12345678')
})

Deno.test('buildCuit: rechaza body de longitud distinta a 8', () => {
  let threw = false
  try { buildCuit(20, '123') } catch { threw = true }
  assertEquals(threw, true)
})
