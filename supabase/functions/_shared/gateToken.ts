// supabase/functions/_shared/gateToken.ts

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i])
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4)
  const norm = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(pad)
  return atob(norm)
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signGateToken(userId: string, ttlSeconds: number, secret: string): Promise<string> {
  const payload = { user_id: userId, exp_unix: Math.floor(Date.now() / 1000) + ttlSeconds }
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  return `${payloadB64}.${b64urlEncode(sig)}`
}

export async function verifyGateToken(token: string, expectedUserId: string, secret: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sigB64] = parts

  const key = await importHmacKey(secret)
  const sigBytes = Uint8Array.from(b64urlDecodeToString(sigB64), (c) => c.charCodeAt(0))
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payloadB64))
  if (!valid) return false

  let payload: { user_id?: string; exp_unix?: number }
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64))
  } catch {
    return false
  }
  if (payload.user_id !== expectedUserId) return false
  if (typeof payload.exp_unix !== 'number') return false
  if (payload.exp_unix < Math.floor(Date.now() / 1000)) return false
  return true
}
