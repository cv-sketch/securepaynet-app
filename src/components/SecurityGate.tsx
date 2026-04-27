// src/components/SecurityGate.tsx
import { useEffect, useState } from 'react'
import { passkeyService } from '../services/passkeyService'

type Props = {
  open: boolean
  reason: string
  onClose: () => void
  onSuccess: (gateToken: string) => void
}

type State = 'idle' | 'pending-passkey' | 'mode-password' | 'pending-password' | 'rate-limited' | 'error'

export default function SecurityGate({ open, reason, onClose, onSuccess }: Props) {
  const [state, setState] = useState<State>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!open) return
    setState('idle')
    setErr(null)
    setPassword('')
    void tryPasskey()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function tryPasskey() {
    if (!passkeyService.isWebAuthnSupported()) {
      setState('mode-password')
      return
    }
    setState('pending-passkey')
    setErr(null)
    try {
      const { gateToken } = await passkeyService.authenticate()
      onSuccess(gateToken)
    } catch (e) {
      const m = (e as Error).message
      if (m === 'NO_PASSKEYS') {
        setState('mode-password')
        return
      }
      if (m === 'CLONED_CREDENTIAL') {
        setErr('Detectamos un problema de seguridad con esta passkey. Eliminala desde Perfil.')
        setState('error')
        return
      }
      setState('mode-password')
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setState('pending-password')
    setErr(null)
    try {
      const { gateToken } = await passkeyService.authenticateWithPassword(password)
      setPassword('')
      onSuccess(gateToken)
    } catch (e) {
      const m = (e as Error).message
      if (m === 'RATE_LIMITED') {
        setState('rate-limited')
        setErr('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.')
        return
      }
      setState('mode-password')
      setErr('Contrasena incorrecta')
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">Confirmar para {reason}</h2>
          <button onClick={onClose} className="text-sm text-slate-500 px-2 py-1">Cancelar</button>
        </div>

        {state === 'pending-passkey' && (
          <div className="text-sm text-slate-600 py-6 text-center">
            Esperando confirmacion del dispositivo...
            <div className="mt-3">
              <button
                onClick={() => setState('mode-password')}
                className="text-xs text-brand-700 font-semibold underline"
              >
                Usar contrasena
              </button>
            </div>
          </div>
        )}

        {(state === 'mode-password' || state === 'pending-password') && (
          <form onSubmit={handlePassword}>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tu contrasena de SecurePayNet
            </label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
            <button
              type="submit"
              disabled={state === 'pending-password' || !password}
              className="w-full mt-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
            >
              {state === 'pending-password' ? 'Verificando...' : 'Confirmar'}
            </button>
            {passkeyService.isWebAuthnSupported() && (
              <button
                type="button"
                onClick={() => void tryPasskey()}
                className="w-full text-xs text-brand-700 font-semibold mt-2"
              >
                Usar passkey en su lugar
              </button>
            )}
          </form>
        )}

        {state === 'rate-limited' && (
          <div className="text-sm text-red-600 py-4">{err}</div>
        )}
        {state === 'error' && (
          <div className="text-sm text-red-600 py-4">{err}</div>
        )}
      </div>
    </div>
  )
}
