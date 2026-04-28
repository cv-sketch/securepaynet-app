export function isValidCuit(cuit: string): boolean {
  const regex = /^\d{11}$/;
  return regex.test(cuit);
}

export function normalizeCuit(cuit: string): string {
  return cuit.replace(/\D/g, '');
}
