// supabase/functions/_shared/pinLockout_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  HARD_LOCK_THRESHOLD,
  isCurrentlyLocked,
  LOCKOUT_DURATION_MIN,
  LOCKOUT_THRESHOLD_FAILS,
  recordFailedAttempt,
} from './pinLockout.ts'

Deno.test('constants: thresholds correctos', () => {
  assertEquals(LOCKOUT_THRESHOLD_FAILS, 3)
  assertEquals(LOCKOUT_DURATION_MIN, 15)
  assertEquals(HARD_LOCK_THRESHOLD, 5)
})

Deno.test('recordFailedAttempt: 1er fail (currentFailed=0) -> incrementa, no lock', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = recordFailedAttempt(0, 0, now)
  assertEquals(r.shouldLock, false)
  assertEquals(r.hardLock, false)
  assertEquals(r.newFailedAttempts, 1)
  assertEquals(r.newLockedUntil, null)
  assertEquals(r.newTotalLockouts, 0)
  assertEquals(r.accountLocked, false)
})

Deno.test('recordFailedAttempt: 2do fail (currentFailed=1) -> incrementa, no lock', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = recordFailedAttempt(1, 0, now)
  assertEquals(r.shouldLock, false)
  assertEquals(r.hardLock, false)
  assertEquals(r.newFailedAttempts, 2)
  assertEquals(r.newLockedUntil, null)
  assertEquals(r.newTotalLockouts, 0)
  assertEquals(r.accountLocked, false)
})

Deno.test('recordFailedAttempt: 3er fail (currentFailed=2) -> LOCK 15min, reset failed counter, +1 totalLockouts', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = recordFailedAttempt(2, 0, now)
  assertEquals(r.shouldLock, true)
  assertEquals(r.hardLock, false)
  assertEquals(r.newFailedAttempts, 0)
  assertEquals(r.newLockedUntil?.getTime(), now.getTime() + 15 * 60 * 1000)
  assertEquals(r.newTotalLockouts, 1)
  assertEquals(r.accountLocked, false)
})

Deno.test('recordFailedAttempt: 5to lockout (totalLockouts=4) -> HARD LOCK', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = recordFailedAttempt(2, 4, now)
  assertEquals(r.shouldLock, true)
  assertEquals(r.hardLock, true)
  assertEquals(r.newTotalLockouts, 5)
  assertEquals(r.accountLocked, true)
  assertEquals(r.newLockedUntil, null)
  assertEquals(r.newFailedAttempts, 0)
})

Deno.test('recordFailedAttempt: 4to lockout (totalLockouts=3) -> NO hard lock todavia', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = recordFailedAttempt(2, 3, now)
  assertEquals(r.shouldLock, true)
  assertEquals(r.hardLock, false)
  assertEquals(r.newTotalLockouts, 4)
  assertEquals(r.accountLocked, false)
  assertEquals(r.newLockedUntil?.getTime(), now.getTime() + 15 * 60 * 1000)
})

Deno.test('isCurrentlyLocked: ningun lock -> false', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = isCurrentlyLocked(null, false, now)
  assertEquals(r.locked, false)
  assertEquals(r.reason, null)
})

Deno.test('isCurrentlyLocked: temporary activo (now < lockedUntil) -> true/temporary', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const lockedUntil = new Date('2026-04-28T12:10:00Z')
  const r = isCurrentlyLocked(lockedUntil, false, now)
  assertEquals(r.locked, true)
  assertEquals(r.reason, 'temporary')
})

Deno.test('isCurrentlyLocked: temporary expirado (now > lockedUntil) -> false', () => {
  const now = new Date('2026-04-28T12:30:00Z')
  const lockedUntil = new Date('2026-04-28T12:10:00Z')
  const r = isCurrentlyLocked(lockedUntil, false, now)
  assertEquals(r.locked, false)
  assertEquals(r.reason, null)
})

Deno.test('isCurrentlyLocked: account_locked=true -> true/account', () => {
  const now = new Date('2026-04-28T12:00:00Z')
  const r = isCurrentlyLocked(null, true, now)
  assertEquals(r.locked, true)
  assertEquals(r.reason, 'account')
})

Deno.test('isCurrentlyLocked: account_locked tiene precedencia sobre temporary expirado', () => {
  const now = new Date('2026-04-28T12:30:00Z')
  const lockedUntil = new Date('2026-04-28T12:10:00Z')
  const r = isCurrentlyLocked(lockedUntil, true, now)
  assertEquals(r.locked, true)
  assertEquals(r.reason, 'account')
})
