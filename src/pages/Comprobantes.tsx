import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, formatDateAR } from '../lib/format'
import ComprobanteModal from '../components/ComprobanteModal'

type CompRow = {
  id: string
  numero: string | null
  created_at: string
  monto: number | string
  titular_destino: string | null
  cvu_destino: string | null
  coelsa_id: string | null
  concepto: string | null
}

type ComprobanteUI = {
  id: string
  numero: string | null
  fecha: string
  tipo: string
  monto: number
  contraparte: string | null
  cbu_contraparte: string | null
  referencia: string | null
  estado: string | null
}

export default function Comprobantes() {
  const { cliente } = useAuth()
  const [items, setItems] = useState<CompRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ComprobanteUI | null>(null)

  useEffect(() => {
    if (!cliente) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('comprobantes')
        .select(
          'id, numero, created_at, monto, titular_destino, cvu_destino, coelsa_id, concepto'
        )
        .eq('cliente_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(100)
      setItems((data ?? []) as CompRow[])
      setLoading(false)
    })()
  }, [cliente])

  const openComprobante = (c: CompRow) => {
    setSelected({
      id: c.id,
      numero: c.numero,
      fecha: c.created_at,
      tipo: 'Transferencia enviada',
      monto: Number(c.monto),
      contraparte: c.titular_destino,
      cbu_contraparte: c.cvu_destino,
      referencia: c.coelsa_id,
      estado: 'completado',
    })
    setOpen(true)
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Comprobantes</h1>
      {loading ? (
        <div className="text-center text-slate-400 py-10">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Aún no tenés comprobantes.
        </div>
      ) : (
        <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {items.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => openComprobante(c)}
                className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    Transferencia enviada
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {c.titular_destino ?? c.numero ?? '-'} ·{' '}
                    {formatDateAR(c.created_at)}
                  </div>
                </div>
                <div className="text-sm font-bold">{formatARS(c.monto)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ComprobanteModal
        open={open}
        onClose={() => setOpen(false)}
        comprobante={selected}
      />
    </div>
  )
}