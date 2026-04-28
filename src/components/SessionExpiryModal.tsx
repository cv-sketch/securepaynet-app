// src/components/SessionExpiryModal.tsx
import { useEffect, useState } from 'react'

type Props = {
  open: boolean
  remainingSeconds: number | null
  onContinue: () => Promise<void> | void
  onLogout: () => Promise<void> | void
}

export default function SessionExpiryModal({ open, remainingSeconds, onContinue, onLogout }: Props) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  if (!open) return null

  const handleContinue = async () => {
    setBusy(true)
    try {
      await onContinue()
    } finally {
      setBusy(false)
    }
  }

  const seconds = Math.max(0, remainingSeconds ?? 0)

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-5">
        <h2 className="text-base font-bold text-slate-800 mb-2">Tu sesión está por expirar</h2>
        <p className="text-sm text-slate-600 mb-4">
          Tu sesión expirará en <strong className="text-red-600">{seconds} segundos</strong> por inactividad.
          ¿Querés seguir conectado?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleContinue}
            disabled={busy}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
          >
            {busy ? 'Conectando...' : 'Seguir conectado'}
          </button>
          <button
            onClick={onLogout}
            className="w-full text-sm text-slate-600 font-medium py-2"
          >
            Cerrar sesión ahora
          </button>
        </div>
      </div>
    </div>
  )
}
