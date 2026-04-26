import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, formatDateAR } from '../lib/format'
import ComprobanteModal from '../components/ComprobanteModal'

type Comp = {
  id: string
  numero: string | null
  fecha: string
  tipo: string
  monto: number | string
  contraparte: string | null
  cbu_contraparte: string | null
  referencia: string | null
  estado: string | null
}

export default function Comprobantes() {
  const { cliente } = useAuth()
  const [items, setItems] = useState<Comp[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Comp | null>(null)

  useEffect(() => {
    if (!cliente) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('comprobantes')
        .select('id, numero, fecha, tipo, monto, contraparte, cbu_contraparte, referencia, estado')
        .eq('cliente_id', cliente.id)
        .order('fecha', { ascending: false })
        .limit(100)
      setItems((data ?? []) as Comp[])
      setLoading(false)
    })()
  }, [cliente])

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
                onClick={() => { setSelected(c); setOpen(true) }}
                className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{c.tipo}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {c.contraparte ?? c.numero ?? '-'} · {formatDateAR(c.fecha)}
                  </div>
                </div>
                <div className="text-sm font-bold">{formatARS(c.monto)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ComprobanteModal open={open} onClose={() => setOpen(false)} comprobante={selected} />
    </div>
  )
}
