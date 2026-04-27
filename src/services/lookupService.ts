// src/services/lookupService.ts
import { supabase } from '../lib/supabase'

export type LookupType = 'cbu' | 'alias'

export type LookupOk = {
  ok: true
  data: { nombre: string; cuit: string; cvu_completo: string; entidad: string }
}
export type LookupErr = {
  ok: false
  code: 'INVALID_FORMAT' | 'NOT_FOUND' | 'ACCOUNT_DISABLED' | 'UPSTREAM_ERROR'
  message: string
}
export type LookupResult = LookupOk | LookupErr

export const lookupService = {
  async lookup(type: LookupType, value: string): Promise<LookupResult> {
    const { data, error } = await supabase.functions.invoke('bdc-proxy', {
      body: { endpoint: 'account.lookup', payload: { type, value } },
    })
    if (error) {
      return { ok: false, code: 'UPSTREAM_ERROR', message: error.message ?? 'Error invocando lookup' }
    }
    return data as LookupResult
  },
}
