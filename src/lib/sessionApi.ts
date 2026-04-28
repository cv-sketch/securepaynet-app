// src/lib/sessionApi.ts
import { supabase } from './supabase'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('no_jwt')
  return fetch(`${FN_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export type CreateSessionResult = {
  session_id: string
  idle_remaining_seconds: number
  absolute_remaining_seconds: number
}

export async function createSession(): Promise<CreateSessionResult> {
  const r = await authedFetch('/session-create', {})
  if (!r.ok) throw new Error(`session-create failed: ${r.status}`)
  return await r.json()
}

export type HeartbeatResult =
  | { ok: true; idle_remaining_seconds: number; absolute_remaining_seconds: number }
  | { ok: false; expired: 'idle' | 'absolute' | 'revoked' }

export async function sessionHeartbeat(sessionId: string): Promise<HeartbeatResult> {
  const r = await authedFetch('/session-heartbeat', { session_id: sessionId })
  if (r.status === 401) {
    const body = await r.json().catch(() => ({}))
    if (body?.expired) return { ok: false, expired: body.expired }
  }
  if (!r.ok) throw new Error(`heartbeat failed: ${r.status}`)
  return await r.json()
}

export async function revokeSession(sessionId: string, reason: 'user' = 'user'): Promise<void> {
  const r = await authedFetch('/session-revoke', { session_id: sessionId, reason })
  if (!r.ok) console.warn('[revokeSession] non-200:', r.status)
}
