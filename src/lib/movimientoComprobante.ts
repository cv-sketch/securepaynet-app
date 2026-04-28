import { supabase } from './supabase'
import type { ComprobanteData } from './comprobantePdf'

export type MovimientoLite = {
  id: string
  created_at: string
  tipo: 'credito' | 'debito' | string
  monto: number | string
  descripcion: string | null
  referencia: string | null
  estado: string | null
  transferencia_id?: string | null
}

export async function fetchComprobanteForMovimiento(
  m: MovimientoLite,
): Promise<ComprobanteData | null> {
  if (m.tipo !== 'debito') return null

  let row: any = null

  if (m.transferencia_id) {
    const { data } = await supabase
      .from('comprobantes')
      .select('id, numero, created_at, monto, titular_destino, cvu_destino, coelsa_id, concepto')
      .eq('transferencia_id', m.transferencia_id)
      .maybeSingle()
    row = data
  }

  if (!row) {
    return {
      id: m.id,
      numero: null,
      fecha: m.created_at,
      tipo: 'Transferencia enviada',
      monto: m.monto,
      contraparte: m.descripcion ?? null,
      cbu_contraparte: null,
      referencia: m.referencia,
      estado: m.estado ?? 'completado',
    }
  }

  return {
    id: row.id,
    numero: row.numero,
    fecha: row.created_at,
    tipo: 'Transferencia enviada',
    monto: row.monto,
    contraparte: row.titular_destino,
    cbu_contraparte: row.cvu_destino,
    referencia: row.coelsa_id,
    estado: 'completado',
  }
}
