// src/components/PinInputModal.tsx
// Modal de entrada de PIN de 6 digitos. Maneja estados typing/submitting/error/locked
// y expone un link "Olvide mi PIN" que dispara magic-link recovery.
// Consumido por: ElevationGate.tsx (Task 12) y por flows directos de useElevation.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElevationScope } from '../lib/pinApi'

type Props = {
  open: boolean
  scope: ElevationScope
  onSubmit: (pin: string) => Promise<{ ok: boolean; error?: string; lockedUntil?: string | null }>
  onCancel: () => void
  onForgot: () => Promise<void>
}

const SCOPE_COPY: Record<ElevationScope, string> = {
  transfer: 'Confirma tu PIN para autorizar la transferencia',
  add_contact: 'Confirma tu PIN para agregar el contacto',
  change_email: 'Confirma tu PIN para cambiar tu email',
  change_pin: 'Confirma tu PIN actual para cambiarlo',
  close_account: 'Confirma tu PIN para cerrar la cuenta',
  export_data: 'Confirma tu PIN para exportar tus datos',
}

function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000))
  const hh = Math.floor(total / 3600).toString().padStart(2, '0')
  const mm = Math.floor((total % 3600) / 60).toString().padStart(2, '0')
  const ss = (total % 60).toString().padStart(2, '0')
  return total >= 3600 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

export default function PinInputModal({ open, scope, onSubmit, onCancel, onForgot }: Props) {
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [forgotMsg, setForgotMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset on open/close.
  useEffect(() => {
    if (!open) return
    setPin('')
    setError(null)
    setSubmitting(false)
    setLockedUntil(null)
    setForgotMsg(null)
    // autoFocus retry — algunos navegadores pierden el focus en modales tras transicion.
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [open])

  // Countdown tick.
  useEffect(() => {
    if (!lockedUntil) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [lockedUntil])

  const lockedRemainingMs = useMemo(() => {
    if (!lockedUntil) return 0
    const t = new Date(lockedUntil).getTime()
    if (Number.isNaN(t)) return 0
    return t - now
  }, [lockedUntil, now])

  const isLocked = lockedRemainingMs > 0

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 6)
    setPin(raw)
    if (error) setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pin.length !== 6 || submitting || isLocked) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await onSubmit(pin)
      if (!r.ok) {
        setPin('')
        if (r.lockedUntil) {
          setLockedUntil(r.lockedUntil)
          setNow(Date.now())
        }
        setError(r.error ?? 'PIN incorrecto')
      }
    } catch (err) {
      setPin('')
      setError((err as Error).message ?? 'Error al verificar PIN')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleForgot() {
    setForgotMsg(null)
    try {
      await onForgot()
      setForgotMsg('Te enviamos un email para recuperar tu PIN.')
    } catch (err) {
      setForgotMsg(`No pudimos enviar el email: ${(err as Error).message ?? 'error'}`)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">Ingresa tu PIN</h2>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-sm text-slate-500 px-2 py-1 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>

        <p className="text-sm text-slate-600 mb-3">{SCOPE_COPY[scope]}</p>

        <form onSubmit={handleSubmit}>
          <label className="block text-xs font-semibold text-slate-700 mb-1">PIN de 6 digitos</label>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={6}
            autoFocus
            value={pin}
            onChange={handleChange}
            disabled={submitting || isLocked}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-lg tracking-[0.5em] text-center outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
            aria-label="PIN de 6 digitos"
          />

          {isLocked && (
            <div className="text-xs text-red-600 mt-2">
              Demasiados intentos. Reintenta en {formatCountdown(lockedRemainingMs)}.
            </div>
          )}

          {!isLocked && error && <div className="text-xs text-red-600 mt-2">{error}</div>}

          <button
            type="submit"
            disabled={submitting || isLocked || pin.length !== 6}
            className="w-full mt-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
          >
            {submitting ? 'Verificando...' : 'Confirmar'}
          </button>
        </form>

        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => void handleForgot()}
            disabled={submitting}
            className="text-xs text-brand-700 font-semibold underline disabled:opacity-50"
          >
            Olvide mi PIN
          </button>
          {forgotMsg && <div className="text-xs text-slate-600 mt-2">{forgotMsg}</div>}
        </div>
      </div>
    </div>
  )
}
