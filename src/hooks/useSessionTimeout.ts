// src/hooks/useSessionTimeout.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionHeartbeat } from '../lib/sessionApi'

const HEARTBEAT_INTERVAL_MS = 30_000      // poll status every 30s (no slide)
const ACTIVITY_DEBOUNCE_MS = 60_000       // slide at most once per minute on real activity
const WARNING_THRESHOLD_S = 60            // show modal at T-60s

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
  const lastActivitySlideAt = useRef<number>(0)

  const ping = useCallback(
    async (slide: boolean) => {
      if (!sessionId) return
      try {
        const r = await sessionHeartbeat(sessionId, slide)
        if (!r.ok) {
          setExpiredReason(r.expired)
          return
        }
        setIdleRemaining(r.idle_remaining_seconds)
        setAbsoluteRemaining(r.absolute_remaining_seconds)
      } catch (e) {
        console.warn('[useSessionTimeout] heartbeat error:', e)
      }
    },
    [sessionId],
  )

  const refresh = useCallback(() => ping(true), [ping])

  // Passive heartbeat: poll for current remaining time without sliding.
  useEffect(() => {
    if (!sessionId) {
      setIdleRemaining(null)
      setAbsoluteRemaining(null)
      setExpiredReason(null)
      return
    }
    void ping(false)
    const id = window.setInterval(() => void ping(false), HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [sessionId, ping])

  // Activity-driven slide: real user gestures extend the session, debounced.
  useEffect(() => {
    if (!sessionId || expiredReason !== null) return
    const onActivity = () => {
      const now = Date.now()
      if (now - lastActivitySlideAt.current < ACTIVITY_DEBOUNCE_MS) return
      lastActivitySlideAt.current = now
      void ping(true)
    }
    const opts: AddEventListenerOptions = { passive: true }
    window.addEventListener('mousedown', onActivity, opts)
    window.addEventListener('keydown', onActivity, opts)
    window.addEventListener('touchstart', onActivity, opts)
    window.addEventListener('scroll', onActivity, opts)
    return () => {
      window.removeEventListener('mousedown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('touchstart', onActivity)
      window.removeEventListener('scroll', onActivity)
    }
  }, [sessionId, expiredReason, ping])

  // Local 1-second decrement for a fluid countdown UI.
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
    refresh,
  }
}
