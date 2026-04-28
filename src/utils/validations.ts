export function isValidCuit(cuit: string): boolean {
  const normalized = normalizeCuit(cuit);
  return /^\d{11}$/.test(normalized);
}

export function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s]/g, '');
}
