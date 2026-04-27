const FACTORS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function cuitCheckDigit(first10Digits: string): number {
  if (!/^\d{10}$/.test(first10Digits)) {
    throw new Error('cuitCheckDigit espera exactamente 10 digitos')
  }
  let sum = 0
  for (let i = 0; i < 10; i++) {
    sum += parseInt(first10Digits[i], 10) * FACTORS[i]
  }
  const mod = sum % 11
  if (mod === 0) return 0
  if (mod === 1) return 9 // convencion BCRA: si da 10, se usa 9
  return 11 - mod
}

export function buildCuit(prefix: 20 | 23 | 24 | 27 | 30 | 33 | 34, body: string): string {
  if (!/^\d{8}$/.test(body)) {
    throw new Error('buildCuit espera body de 8 digitos')
  }
  const first10 = `${prefix}${body}`
  return `${first10}${cuitCheckDigit(first10)}`
}
