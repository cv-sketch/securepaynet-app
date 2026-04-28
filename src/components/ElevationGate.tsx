// src/components/ElevationGate.tsx
// Wrapper FaaC (function-as-children) que provee a sus hijos un trigger() que
// devuelve el elevation_token (o null si el usuario cancelo). Internamente
// orquesta passkey-first / PIN-fallback usando useElevation y monta el
// <PinInputModal>.
// Consumido por: Contactos.tsx, Transferir.tsx, Perfil.tsx, Seguridad.tsx,
// Baja.tsx (Task 17 del plan). Reemplaza el uso de <SecurityGate> en flujos
// post-login que requieren elevacion scoped.
import { useElevation } from '../hooks/useElevation'
import type { ElevationScope } from '../lib/pinApi'
import PinInputModal from './PinInputModal'

type Props = {
  scope: ElevationScope
  children: (args: {
    trigger: () => Promise<string | null>
    pending: boolean
  }) => React.ReactNode
}

export default function ElevationGate({ scope, children }: Props) {
  const { request, pending, modalProps } = useElevation()

  const trigger = () => request(scope)

  return (
    <>
      {children({ trigger, pending })}
      <PinInputModal {...modalProps} />
    </>
  )
}
