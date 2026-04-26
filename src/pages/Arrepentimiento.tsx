import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'

export default function Arrepentimiento() {
  const { cliente } = useAuth()
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cliente) return
    setLoading(true)
    setMsg(null)
    const { error } = await supabase.from('solicitudes_legales').insert({
      cliente_id: cliente.id,
      tipo: 'arrepentimiento',
      motivo: motivo || null,
      estado: 'pendiente',
    })
    setLoading(false)
    if (error) setMsg({ ok: false, text: error.message })
    else {
      setMsg({ ok: true, text: 'Solicitud registrada. Procesaremos tu pedido en los plazos legales.' })
      setMotivo('')
    }
  }

  return (
    <div className="p-4 space-y-4">
      <Link to="/legales" className="text-xs text-brand-600">&larr; Volver a Legales</Link>
      <h1 className="text-xl font-bold">Boton de Arrepentimiento</h1>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900">
        <strong>Resolucion 424/2020 SCI.</strong> Tenes derecho a revocar la aceptacion del servicio
        dentro de los 10 (diez) dias corridos contados a partir de la celebracion del contrato o
        de la entrega del bien, sin responsabilidad alguna.
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm space-y-1">
          <div className="text-xs text-slate-500">Solicitante</div>
          <div className="font-medium">{cliente?.nombre ?? '-'}</div>
          <div className="text-xs text-slate-500 mt-2">CUIT/CUIL</div>
          <div>{cliente?.cuit ?? '-'}</div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Motivo (opcional)
          </label>
          <textarea
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Contanos brevemente el motivo de tu arrepentimiento..."
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
          className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          {loading ? 'Enviando...' : 'Enviar solicitud de arrepentimiento'}
        </button>

        <p className="text-[11px] text-slate-400 text-center">
          La solicitud sera procesada en un plazo maximo de 10 dias habiles.
        </p>
      </form>
    </div>
  )
}
