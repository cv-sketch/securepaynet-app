import { supabase } from '../lib/supabase'

/**
 * bdcService - Cliente del front contra el sistema de wallets BDC.
 *
 * Portado desde bdcconecta-dashboard. Usa el mismo Edge Function `bdc-proxy`
 * y el mismo contrato. El modo (mock | live) se controla en el Edge Function
 * con la env var `BDC_MODE`.
 */

const FUNCTION_NAME = 'bdc-proxy'

async function callBdcProxy<T = unknown>(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; message?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
      body: { endpoint, payload },
    })
    if (error) {
      return { ok: false, message: error.message ?? 'Error invocando bdc-proxy' }
    }
    if (
      data &&
      typeof data === 'object' &&
      'ok' in data &&
      (data as { ok: boolean }).ok === false
    ) {
      return {
        ok: false,
        message: (data as { message?: string }).message ?? 'Error en bdc-proxy',
      }
    }
    return { ok: true, data: data as T }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Error desconocido invocando bdc-proxy'
    return { ok: false, message }
  }
}

export const bdcService = {
  async enviarTransferencia(params: {
    originId: string
    fromAddress: string
    fromCuit: string
    toAddress: string
    toCuit: string
    amount: number
    concept?: string
    description?: string
  }) {
    const result = await callBdcProxy<{ coelsaId?: string; message?: string }>(
      'transfer.create',
      {
        originId: params.originId,
        fromAccount: { cvu: params.fromAddress, cuit: params.fromCuit },
        toAccount: { cvu: params.toAddress, cuit: params.toCuit },
        amount: params.amount,
        concept: params.concept,
        description: params.description,
      }
    )
    if (!result.ok) return { ok: false as const, message: result.message }
    return {
      ok: true as const,
      coelsaId: result.data?.coelsaId,
      message: result.data?.message ?? 'Transferencia creada con exito',
    }
  },

  async consultarMovimientos(cvu: string) {
    const result = await callBdcProxy<{ movimientos?: unknown[] }>(
      'transfer.list',
      { cvu }
    )
    if (!result.ok) return { ok: false as const, message: result.message }
    return { ok: true as const, movimientos: result.data?.movimientos ?? [] }
  },

  async consultarCuenta(cvu: string) {
    const result = await callBdcProxy<{
      cuenta?: { cvu: string; saldo: number; estado: string }
    }>('sub-account.list', { cvu })
    if (!result.ok) return { ok: false as const, message: result.message }
    return { ok: true as const, cuenta: result.data?.cuenta }
  },
}