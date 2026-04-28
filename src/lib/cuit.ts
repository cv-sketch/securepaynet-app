// Validacion de CUIT argentino (BCRA): 11 digitos con digito verificador modulo 11.

const FACTORS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function cuitCheckDigit(first10Digits: string): number {
  if (!/^\d{10}$/.test(first10Digits)) throw new Error('expected 10 digits')
  let sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(first10Digits[i], 10) * FACTORS[i]
  const mod = sum % 11
  if (mod === 0) return 0
  if (mod === 1) return 9
  return 11 - mod
}

export function normalizeCuit(input: string): string {
  return input.replace(/\D/g, '')
}

export function isValidCuit(input: string): boolean {
  const d = normalizeCuit(input)
  if (!/^\d{11}$/.test(d)) return false
  const prefix = d.slice(0, 2)
  // 20/23/24/27 = persona fisica; 30/33/34 = juridica. Rechazamos otros prefijos.
  if (!['20', '23', '24', '27', '30', '33', '34'].includes(prefix)) return false
  const expected = cuitCheckDigit(d.slice(0, 10))
  return parseInt(d[10], 10) === expected
}

export function formatCuit(input: string): string {
  const d = normalizeCuit(input).slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}
