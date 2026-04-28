// src/hooks/useElevation.ts
// Orquestador de elevacion: passkey-first -> fallback PIN modal.
// Uso tipico:
//   const { request, modalProps, pending } = useElevation()
//   const token = await request('transfer')   // string | null
//   if (token) await mutate({ ...payload, elevation_token: token })
//
// modalProps se pasa a <PinInputModal {...modalProps} />.
// Consumido por: ElevationGate.tsx y por pages que prefieran consumir el hook
// directamente (Contactos, Transferir, Perfil, Seguridad, Baja).
import { useCallback, useRef, useState } from 'react'
import { elevateWithPasskey } from '../lib/elevationApi'
import { verifyPin, type ElevationScope } from '../lib/pinApi'
import { supabase } from '../lib/supabase'
import { useAuth } from '../store/useAuth'

type SubmitResult = { ok: boolean; error?: string; lockedUntil?: string | null }

export type UseElevationApi = {
  request: (scope: ElevationScope) => Promise<string | null>
  pending: boolean
  modalOpen: boolean
  modalProps: {
    open: boolean
    scope: ElevationScope
    onSubmit: (pin: string) => Promise<SubmitResult>
    onCancel: () => void
    onForgot: () => Promise<void>
  }
}

const FALLBACK_SCOPE: ElevationScope = 'transfer'

export function useElevation(): UseElevationApi {
  const [pending, setPending] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [scope, setScope] = useState<ElevationScope>(FALLBACK_SCOPE)
  // Promise pendiente del PIN modal (resuelve a token o null en cancel).
  const pendingResolveRef = useRef<((value: string | null) => void) | null>(null)
  const userEmail = useAuth((s) => s.user?.email ?? null)

  const finishWith = useCallback((token: string | null) => {
    const resolve = pendingResolveRef.current
    pendingResolveRef.current = null
    setModalOpen(false)
    setPending(false)
    if (resolve) resolve(token)
  }, [])

  const request = useCallback(async (s: ElevationScope): Promise<string | null> => {
    setPending(true)
    setScope(s)

    // 1) passkey-first
    const pk = await elevateWithPasskey(s)
    if (pk.ok) {
      setPending(false)
      return pk.elevation_token
    }
    // verify_failed con passkey: bajamos a PIN igualmente para no bloquear UX.
    // (no_passkeys / cancelled / verify_failed -> abrir PIN modal)

    // 2) fallback: abrir PIN modal y esperar resolucion
    return await new Promise<string | null>((resolve) => {
      pendingResolveRef.current = resolve
      setModalOpen(true)
    })
  }, [])

  const onSubmit = useCallback(async (pin: string): Promise<SubmitResult> => {
    const r = await verifyPin(pin, scope)
    if (r.ok) {
      finishWith(r.elevation_token)
      return { ok: true }
    }
    if (r.reason === 'locked') {
      return { ok: false, error: 'PIN bloqueado temporalmente.', lockedUntil: r.locked_until ?? null }
    }
    if (r.reason === 'account_locked') {
      // Cerrar modal: la cuenta esta bloqueada, debe usar recovery.
      finishWith(null)
      return { ok: false, error: 'Tu cuenta esta bloqueada. Usa "Olvide mi PIN" para recuperarla.' }
    }
    if (r.reason === 'pin_not_set') {
      finishWith(null)
      return { ok: false, error: 'No tienes un PIN configurado.' }
    }
    const left = typeof r.attempts_remaining === 'number' ? r.attempts_remaining : null
    const msg = left !== null
      ? `PIN incorrecto. Te quedan ${left} intento${left === 1 ? '' : 's'}.`
      : 'PIN incorrecto.'
    return { ok: false, error: msg, lockedUntil: r.locked_until ?? null }
  }, [scope, finishWith])

  const onCancel = useCallback(() => {
    finishWith(null)
  }, [finishWith])

  const onForgot = useCallback(async () => {
    if (!userEmail) throw new Error('No hay email asociado a la sesion.')
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
      redirectTo: `${window.location.origin}/pin-recovery`,
    })
    if (error) throw error
  }, [userEmail])

  return {
    request,
    pending,
    modalOpen,
    modalProps: {
      open: modalOpen,
      scope,
      onSubmit,
      onCancel,
      onForgot,
    },
  }
}
