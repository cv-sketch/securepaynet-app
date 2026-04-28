// src/hooks/useSessionTimeout.ts
import { useEffect, useRef, useState } from 'react'
import { sessionHeartbeat } from '../lib/sessionApi'

const HEARTBEAT_INTERVAL_MS = 30_000 // 30s
const WARNING_THRESHOLD_S = 60       // mostrar modal a T-60s

export type SessionTimeoutState = {
  idleRemaining: number | null
  absoluteRemaining: number | null
  showWarning: boolean
  expiredReason: 'idle' | 'absolute' | 'revoked' | null
  refresh: () => Promise<void>
}

export function useSessionTimeout(sessionId: string | null): SessionTimeoutState {
  const [idleRemaining, setIdleRemaining] = useState<number | null>(null)
  const [absoluteRemaining, setAbsoluteRemaining] = useState<number | null>(null)
  const [expiredReason, setExpiredReason] = useState<'idle' | 'absolute' | 'revoked' | null>(null)
  const tickRef = useRef<number | null>(null)

  const ping = async () => {
    if (!sessionId) return
    try {
      const r = await sessionHeartbeat(sessionId)
      if (!r.ok) {
        setExpiredReason(r.expired)
        return
      }
      setIdleRemaining(r.idle_remaining_seconds)
      setAbsoluteRemaining(r.absolute_remaining_seconds)
    } catch (e) {
      console.warn('[useSessionTimeout] heartbeat error:', e)
    }
  }

  useEffect(() => {
    if (!sessionId) {
      setIdleRemaining(null)
      setAbsoluteRemaining(null)
      setExpiredReason(null)
      return
    }
    void ping()
    const id = window.setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Decremento local cada segundo (UX fluida del countdown).
  useEffect(() => {
    if (idleRemaining === null || expiredReason !== null) return
    if (tickRef.current) window.clearInterval(tickRef.current)
    tickRef.current = window.setInterval(() => {
      setIdleRemaining((v) => (v !== null && v > 0 ? v - 1 : v))
      setAbsoluteRemaining((v) => (v !== null && v > 0 ? v - 1 : v))
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [idleRemaining === null, expiredReason])

  const showWarning =
    idleRemaining !== null && idleRemaining <= WARNING_THRESHOLD_S && expiredReason === null

  return {
    idleRemaining,
    absoluteRemaining,
    showWarning,
    expiredReason,
    refresh: ping,
  }
}
