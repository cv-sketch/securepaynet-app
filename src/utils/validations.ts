export function isValidCuit(cuit: string): boolean {
  const normalized = normalizeCuit(cuit);
  return /^\d{11}$/.test(normalized);
}

export function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s]/g, '');
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (password.length < 6) {
    return { valid: false, message: 'La contraseña debe tener al menos 6 caracteres' };
  }
  return { valid: true };
}

export function validatePasswordMatch(password: string, confirmPassword: string): boolean {
  return password === confirmPassword;
}

export function validateCuitMatch(cuit: string, confirmCuit: string): boolean {
  return normalizeCuit(cuit) === normalizeCuit(confirmCuit);
}

export function validateOtpCode(otpCode: string): boolean {
  return /^\d{6}$/.test(otpCode);
}
