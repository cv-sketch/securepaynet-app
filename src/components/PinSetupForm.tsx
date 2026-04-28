// src/components/PinSetupForm.tsx
// Form de setup de PIN: dos inputs (PIN + confirmacion) con validacion en vivo.
// Reusable en:
//   - mode='initial' -> llama setInitialPin (Signup, /pin-setup forzado)
//   - mode='recovery' -> llama recoveryResetPin (/pin-recovery post magic-link)
// Consumido por: Signup.tsx, PinSetup.tsx (Task 15), PinRecovery.tsx (Task 16).
import { useMemo, useState } from 'react'
import { recoveryResetPin, setInitialPin } from '../lib/pinApi'

type Props = {
  mode: 'initial' | 'recovery'
  onComplete: () => void
}

const PIN_REGEX = /^[0-9]{6}$/

function sanitize(v: string): string {
  return v.replace(/\D/g, '').slice(0, 6)
}

export default function PinSetupForm({ mode, onComplete }: Props) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formatValid = useMemo(() => PIN_REGEX.test(pin), [pin])
  const matches = useMemo(() => pin.length > 0 && pin === confirm, [pin, confirm])
  const canSubmit = formatValid && matches && !submitting

  // Indicador en vivo: 'empty' | 'mismatch' | 'match' | 'too-short'
  const matchState: 'empty' | 'too-short' | 'mismatch' | 'match' = (() => {
    if (!pin && !confirm) return 'empty'
    if (!formatValid) return 'too-short'
    if (!matches) return 'mismatch'
    return 'match'
  })()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const r = mode === 'initial' ? await setInitialPin(pin) : await recoveryResetPin(pin)
      if (r.ok) {
        onComplete()
        return
      }
      const errMsg = 'error' in r && r.error
        ? r.error
        : 'No pudimos guardar el PIN. Intenta de nuevo.'
      // Mensajes amigables para errores conocidos.
      if (errMsg === 'pin_already_set') {
        setError('Ya tienes un PIN configurado. Usa "Cambiar PIN" en Seguridad.')
      } else if (errMsg === 'fresh_session_required') {
        setError('Tu sesion debe ser reciente. Volve a iniciar sesion para recuperar el PIN.')
      } else if (errMsg === 'cooldown_active') {
        const retry = 'retry_after' in r && r.retry_after ? ` Intenta de nuevo en ${r.retry_after}s.` : ''
        setError(`Recuperacion en cooldown.${retry}`)
      } else if (errMsg === 'invalid_pin_format') {
        setError('El PIN debe tener exactamente 6 digitos.')
      } else {
        setError(errMsg)
      }
    } catch (err) {
      setError((err as Error).message ?? 'Error de red')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="pin" className="block text-xs font-semibold text-slate-700 mb-1">
          PIN de 6 digitos
        </label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => setPin(sanitize(e.target.value))}
          disabled={submitting}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-lg tracking-[0.5em] text-center outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
          aria-label="PIN de 6 digitos"
        />
      </div>

      <div>
        <label htmlFor="pin-confirm" className="block text-xs font-semibold text-slate-700 mb-1">
          Confirma tu PIN
        </label>
        <input
          id="pin-confirm"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={6}
          value={confirm}
          onChange={(e) => setConfirm(sanitize(e.target.value))}
          disabled={submitting}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-lg tracking-[0.5em] text-center outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
          aria-label="Confirmacion del PIN"
        />
        <div className="mt-1 text-xs h-4">
          {matchState === 'too-short' && (
            <span className="text-slate-500">El PIN debe tener 6 digitos numericos.</span>
          )}
          {matchState === 'mismatch' && (
            <span className="text-red-600">Los PIN no coinciden.</span>
          )}
          {matchState === 'match' && (
            <span className="text-emerald-600">PIN listo.</span>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
      >
        {submitting
          ? 'Guardando...'
          : mode === 'initial'
            ? 'Crear PIN'
            : 'Restablecer PIN'}
      </button>
    </form>
  )
}
