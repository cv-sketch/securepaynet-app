import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, formatDateAR } from '../lib/format'

type MovRow = {
  id: string
  created_at: string
  tipo: 'credito' | 'debito'
  monto: number | string
  descripcion: string | null
  referencia: string | null
  estado: string | null
}

export default function Movimientos() {
  const { cliente } = useAuth()
  const [items, setItems] = useState<MovRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!cliente) return
    ;(async () => {
      setLoading(true)

      // 1. Obtener wallet_id del cliente actual
      const { data: wallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('cliente_id', cliente.id)
        .maybeSingle()

      if (!wallet) {
        setItems([])
        setLoading(false)
        return
      }

      // 2. Cargar movimientos de esa wallet
      const { data } = await supabase
        .from('movimientos')
        .select('id, created_at, tipo, monto, descripcion, referencia, estado')
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false })
        .limit(100)

      setItems((data ?? []) as MovRow[])
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
            const monto = Number(m.monto)
            const isCredito = m.tipo === 'credito'
            return (
              <li
                key={m.id}
                className="p-3 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {m.descripcion || (isCredito ? 'Crédito' : 'Débito')}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {isCredito ? 'Recibido' : 'Enviado'} ·{' '}
                    {formatDateAR(m.created_at)}
                  </div>
                </div>
                <div
                  className={`text-sm font-bold ${
                    isCredito ? 'text-emerald-600' : 'text-slate-900'
                  }`}
                >
                  {isCredito ? '+ ' : '- '}
                  {formatARS(monto)}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}