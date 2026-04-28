// supabase/functions/_shared/sessionConfig_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { resolveSessionConfig } from './sessionConfig.ts'

Deno.test('resolveSessionConfig: rol standard usa defaults', () => {
  const env = {
    SESSION_IDLE_TIMEOUT_SECONDS: '900',
    SESSION_ABSOLUTE_LIFETIME_SECONDS: '28800',
    SESSION_PRIVILEGED_IDLE_SECONDS: '600',
    SESSION_PRIVILEGED_ABSOLUTE_SECONDS: '14400',
  }
  const cfg = resolveSessionConfig('standard', env)
  assertEquals(cfg.idleSeconds, 900)
  assertEquals(cfg.absoluteSeconds, 28800)
})

Deno.test('resolveSessionConfig: roles admin/compliance/soporte usan privileged', () => {
  const env = {
    SESSION_IDLE_TIMEOUT_SECONDS: '900',
    SESSION_ABSOLUTE_LIFETIME_SECONDS: '28800',
    SESSION_PRIVILEGED_IDLE_SECONDS: '600',
    SESSION_PRIVILEGED_ABSOLUTE_SECONDS: '14400',
  }
  for (const role of ['admin', 'compliance', 'soporte']) {
    const cfg = resolveSessionConfig(role, env)
    assertEquals(cfg.idleSeconds, 600, `idle for ${role}`)
    assertEquals(cfg.absoluteSeconds, 14400, `absolute for ${role}`)
  }
})

Deno.test('resolveSessionConfig: rol desconocido cae a standard', () => {
  const env = {
    SESSION_IDLE_TIMEOUT_SECONDS: '900',
    SESSION_ABSOLUTE_LIFETIME_SECONDS: '28800',
    SESSION_PRIVILEGED_IDLE_SECONDS: '600',
    SESSION_PRIVILEGED_ABSOLUTE_SECONDS: '14400',
  }
  const cfg = resolveSessionConfig('emprendedor', env)
  assertEquals(cfg.idleSeconds, 900)
  assertEquals(cfg.absoluteSeconds, 28800)
})

Deno.test('resolveSessionConfig: env vars ausentes usan defaults hardcoded', () => {
  const cfg = resolveSessionConfig('standard', {})
  assertEquals(cfg.idleSeconds, 900)
  assertEquals(cfg.absoluteSeconds, 28800)
})
