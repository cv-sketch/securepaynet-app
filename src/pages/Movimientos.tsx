import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, formatDateAR } from '../lib/format'

type Mov = {
  id: string
  fecha: string
  tipo: string
  signo: number
  monto: number | string
  descripcion: string | null
  contraparte: string | null
}

export default function Movimientos() {
  const { cliente } = useAuth()
  const [items, setItems] = useState<Mov[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!cliente) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('movimientos')
        .select('id, fecha, tipo, signo, monto, descripcion, contraparte')
        .eq('cliente_id', cliente.id)
        .order('fecha', { ascending: false })
        .limit(100)
      setItems((data ?? []) as Mov[])
      setLoading(false)
    })()
  }, [cliente])

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Movimientos</h1>
      {loading ? (
        <div className="text-center text-slate-400 py-10">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Aun no tenes movimientos.
        </div>
      ) : (
        <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {items.map((m) => {
            const monto = Number(m.monto) * (m.signo < 0 ? -1 : 1)
            const isPositive = monto >= 0
            return (
              <li key={m.id} className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {m.descripcion || m.tipo}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {m.contraparte ?? m.tipo} - {formatDateAR(m.fecha)}
                  </div>
                </div>
                <div className={`text-sm font-bold ${isPositive ? 'text-emerald-600' : 'text-slate-900'}`}>
                  {isPositive ? '+ ' : '- '}{formatARS(Math.abs(monto))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
