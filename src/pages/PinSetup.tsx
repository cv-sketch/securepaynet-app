// src/pages/PinSetup.tsx
// Forced PIN setup landing for existing users (pin_set === false post-login).
// El guard en <Protected> (App.tsx) redirige aca despues de hidratar si pin_set
// es false. Tambien usado como destino post-Signup en algun edge case.
// Consumido por: App.tsx (route /pin-setup).
import { useNavigate } from 'react-router-dom'
import PinSetupForm from '../components/PinSetupForm'

export default function PinSetup() {
  const nav = useNavigate()
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-5">
          <div className="text-2xl font-bold text-brand-600">SecurePayNet</div>
          <div className="text-sm text-slate-500 mt-1">Configura tu PIN</div>
        </div>

        <p className="text-sm text-slate-700 mb-5">
          Por seguridad, necesitas un PIN de 6 digitos para autorizar transferencias
          y otras operaciones sensibles. Lo vas a usar cada vez que tu dispositivo no
          confirme con biometria.
        </p>

        <PinSetupForm mode="initial" onComplete={() => nav('/', { replace: true })} />

        <p className="text-[11px] text-slate-400 text-center mt-4">
          Si lo olvidas podes recuperarlo desde el modal de PIN con &quot;Olvide mi PIN&quot;.
        </p>
      </div>
    </div>
  )
}
