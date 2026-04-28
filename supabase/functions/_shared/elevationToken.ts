// supabase/functions/_shared/elevationToken.ts

export type ElevationScope =
  | 'transfer'
  | 'add_contact'
  | 'change_email'
  | 'change_pin'
  | 'close_account'
  | 'export_data'

const VALID_SCOPES: ReadonlySet<ElevationScope> = new Set<ElevationScope>([
  'transfer',
  'add_contact',
  'change_email',
  'change_pin',
  'close_account',
  'export_data',
])

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

export async function signElevationToken(
  userId: string,
  scope: ElevationScope,
  ttlSeconds: number,
  secret: string
): Promise<string> {
  const payload = {
    user_id: userId,
    scope,
    exp_unix: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: crypto.randomUUID(),
  }
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  return `${payloadB64}.${b64urlEncode(sig)}`
}

export async function verifyElevationToken(
  token: string,
  expectedUserId: string,
  expectedScope: ElevationScope,
  secret: string
): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) return false

  let key: CryptoKey
  try {
    key = await importHmacKey(secret)
  } catch {
    return false
  }

  let sigBuf: ArrayBuffer
  try {
    const decoded = b64urlDecodeToString(sigB64)
    const buf = new ArrayBuffer(decoded.length)
    const view = new Uint8Array(buf)
    for (let i = 0; i < decoded.length; i++) view[i] = decoded.charCodeAt(i)
    sigBuf = buf
  } catch {
    return false
  }

  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuf,
      new TextEncoder().encode(payloadB64)
    )
  } catch {
    return false
  }
  if (!valid) return false

  let payload: { user_id?: string; scope?: string; exp_unix?: number; jti?: string }
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64))
  } catch {
    return false
  }

  if (payload.user_id !== expectedUserId) return false
  if (payload.scope !== expectedScope) return false
  if (typeof payload.scope !== 'string' || !VALID_SCOPES.has(payload.scope as ElevationScope)) {
    return false
  }
  if (typeof payload.exp_unix !== 'number') return false
  if (payload.exp_unix < Math.floor(Date.now() / 1000)) return false
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) return false
  return true
}
