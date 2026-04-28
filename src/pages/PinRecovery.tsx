// src/pages/PinRecovery.tsx
// Landing post-magic-link de recuperacion de PIN.
// Flujo: usuario clickea "Olvide mi PIN" en PinInputModal -> useElevation.onForgot
// llama supabase.auth.resetPasswordForEmail con redirectTo /pin-recovery -> al
// volver, esta pagina valida sesion fresca y muestra <PinSetupForm mode='recovery'>.
// Consumido por: App.tsx (route /pin-recovery).
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import PinSetupForm from '../components/PinSetupForm'

export default function PinRecovery() {
  const { user, hydrating } = useAuth()
  const nav = useNavigate()

  if (hydrating) {
    return <div className="p-8 text-center text-slate-500">Cargando...</div>
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-5">
          <div className="text-2xl font-bold text-brand-600">SecurePayNet</div>
          <div className="text-sm text-slate-500 mt-1">Recuperar PIN</div>
        </div>

        <p className="text-sm text-slate-700 mb-5">
          Confirma tu nuevo PIN. Esta accion reinicia tus intentos fallidos y
          desbloquea tu cuenta.
        </p>

        <PinSetupForm mode="recovery" onComplete={() => nav('/', { replace: true })} />

        <p className="text-[11px] text-slate-400 text-center mt-4">
          Por politica solo podes recuperar tu PIN una vez cada 24h. Si necesitas ayuda
          escribi a soporte.
        </p>
      </div>
    </div>
  )
}
