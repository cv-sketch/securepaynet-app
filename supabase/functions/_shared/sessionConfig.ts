// supabase/functions/_shared/sessionConfig.ts
// Resuelve duración de idle / absolute timeout en base al rol del usuario.

export type SessionConfig = {
  idleSeconds: number
  absoluteSeconds: number
}

const PRIVILEGED_ROLES = new Set(['admin', 'compliance', 'soporte'])

const DEFAULTS = {
  standardIdle: 900,
  standardAbsolute: 28800,
  privilegedIdle: 600,
  privilegedAbsolute: 14400,
}

function readInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function resolveSessionConfig(role: string, env: Record<string, string | undefined>): SessionConfig {
  const isPrivileged = PRIVILEGED_ROLES.has(role)
  if (isPrivileged) {
    return {
      idleSeconds: readInt(env, 'SESSION_PRIVILEGED_IDLE_SECONDS', DEFAULTS.privilegedIdle),
      absoluteSeconds: readInt(env, 'SESSION_PRIVILEGED_ABSOLUTE_SECONDS', DEFAULTS.privilegedAbsolute),
    }
  }
  return {
    idleSeconds: readInt(env, 'SESSION_IDLE_TIMEOUT_SECONDS', DEFAULTS.standardIdle),
    absoluteSeconds: readInt(env, 'SESSION_ABSOLUTE_LIFETIME_SECONDS', DEFAULTS.standardAbsolute),
  }
}
