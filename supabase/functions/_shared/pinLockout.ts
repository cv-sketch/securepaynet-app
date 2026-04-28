// supabase/functions/_shared/pinLockout.ts
// Pure state-machine helpers for PIN failure tracking and lockout decisions.
// No I/O. The Edge Function (pin-verify) is responsible for persisting the
// returned new state to user_security.

export const LOCKOUT_THRESHOLD_FAILS = 3
export const LOCKOUT_DURATION_MIN = 15
export const HARD_LOCK_THRESHOLD = 5

export type LockoutDecision = {
  shouldLock: boolean
  hardLock: boolean
  newFailedAttempts: number
  newLockedUntil: Date | null
  newTotalLockouts: number
  accountLocked: boolean
}

export function recordFailedAttempt(
  currentFailed: number,
  currentTotalLockouts: number,
  now: Date = new Date()
): LockoutDecision {
  const nextFailed = currentFailed + 1

  if (nextFailed < LOCKOUT_THRESHOLD_FAILS) {
    return {
      shouldLock: false,
      hardLock: false,
      newFailedAttempts: nextFailed,
      newLockedUntil: null,
      newTotalLockouts: currentTotalLockouts,
      accountLocked: false,
    }
  }

  // Hit the per-window threshold: trigger a lockout, reset failed counter,
  // increment totalLockouts.
  const nextTotalLockouts = currentTotalLockouts + 1

  if (nextTotalLockouts >= HARD_LOCK_THRESHOLD) {
    return {
      shouldLock: true,
      hardLock: true,
      newFailedAttempts: 0,
      newLockedUntil: null,
      newTotalLockouts: nextTotalLockouts,
      accountLocked: true,
    }
  }

  const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MIN * 60 * 1000)
  return {
    shouldLock: true,
    hardLock: false,
    newFailedAttempts: 0,
    newLockedUntil: lockedUntil,
    newTotalLockouts: nextTotalLockouts,
    accountLocked: false,
  }
}

export function isCurrentlyLocked(
  lockedUntil: Date | null,
  accountLocked: boolean,
  now: Date = new Date()
): { locked: boolean; reason: 'temporary' | 'account' | null } {
  if (accountLocked) {
    return { locked: true, reason: 'account' }
  }
  if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
    return { locked: true, reason: 'temporary' }
  }
  return { locked: false, reason: null }
}
