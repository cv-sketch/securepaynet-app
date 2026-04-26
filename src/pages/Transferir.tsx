import { useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS } from '../lib/format'

export default function Transferir() {
  const { cliente } = useAuth()
  const [destino, setDestino] = useState('')
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!cliente) return
    const m = parseFloat(monto)
    if (isNaN(m) || m <= 0) {
      setMsg({ ok: false, text: 'Ingresa un monto valido' })
      return
    }
    if (!destino || destino.length < 6) {
      setMsg({ ok: false, text: 'Ingresa un CVU o alias valido' })
      return
    }
    setLoading(true)
    const { error } = await supabase.from('transferencias').insert({
      cliente_id: cliente.id,
      destino_cbu_alias: destino,
      monto: m,
      concepto: concepto || null,
      estado: 'pendiente',
    })
    setLoading(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({ ok: true, text: 'Transferencia enviada. Recibiras el comprobante en breve.' })
      setDestino('')
      setMonto('')
      setConcepto('')
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Transferir</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">CVU, CBU o alias</label>
          <input
            type="text"
            required
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="0000003100000000000000 o alias.persona"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Monto (ARS)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-lg font-bold outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="0.00"
          />
          {monto && !isNaN(parseFloat(monto)) && (
            <div className="text-xs text-slate-500 mt-1">{formatARS(parseFloat(monto))}</div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Concepto (opcional)</label>
          <input
            type="text"
            maxLength={80}
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Ej: pago alquiler"
          />
        </div>

        {msg && (
          <div className={`text-xs rounded-lg p-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          {loading ? 'Procesando...' : 'Enviar transferencia'}
        </button>

        <p className="text-[11px] text-slate-400 text-center">
          Operaciones sujetas a normativa BCRA. Verifica los datos antes de confirmar.
        </p>
      </form>
    </div>
  )
}
