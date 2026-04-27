// src/lib/webauthn.ts
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser'

export const isWebAuthnSupported = () => browserSupportsWebAuthn()

export async function registerCredential(options: Parameters<typeof startRegistration>[0]) {
  return await startRegistration(options)
}

export async function authenticateCredential(options: Parameters<typeof startAuthentication>[0]) {
  return await startAuthentication(options)
}

export function detectDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Dispositivo'
}
