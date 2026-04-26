import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'

export default function Baja() {
  const { cliente } = useAuth()
  const [motivo, setMotivo] = useState('')
  const [confirma, setConfirma] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cliente || !confirma) return
    setLoading(true)
    setMsg(null)
    const { error } = await supabase.from('solicitudes_legales').insert({
      cliente_id: cliente.id,
      tipo: 'baja',
      motivo: motivo || null,
      estado: 'pendiente',
    })
    setLoading(false)
    if (error) setMsg({ ok: false, text: error.message })
    else {
      setMsg({ ok: true, text: 'Solicitud de baja registrada. Te contactaremos para coordinar el cierre.' })
      setMotivo('')
      setConfirma(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <Link to="/legales" className="text-xs text-brand-600">&larr; Volver a Legales</Link>
      <h1 className="text-xl font-bold">Solicitud de Baja</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900">
        <strong>Resolucion 316/2018 SCI.</strong> Tenes derecho a solicitar la baja del servicio en
        cualquier momento, por el mismo medio en que fue contratado, sin necesidad de justificacion.
        La baja sera efectiva dentro de las 72 horas habiles de recibida la solicitud.
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm space-y-1">
          <div className="text-xs text-slate-500">Titular</div>
          <div className="font-medium">{cliente?.nombre ?? '-'}</div>
          <div className="text-xs text-slate-500 mt-2">CUIT/CUIL</div>
          <div>{cliente?.cuit ?? '-'}</div>
          <div className="text-xs text-slate-500 mt-2">CVU</div>
          <div className="font-mono text-xs">{cliente?.cvu ?? '-'}</div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Motivo (opcional)
          </label>
          <textarea
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Por que solicitas la baja?"
          />
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={confirma}
            onChange={(e) => setConfirma(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Confirmo que solicito la baja de mi cuenta SecurePayNet. Entiendo que cualquier
            saldo remanente sera transferido a una CBU de mi titularidad.
          </span>
        </label>

        {msg && (
          <div className={`text-xs rounded-lg p-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !confirma}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          {loading ? 'Enviando...' : 'Solicitar baja del servicio'}
        </button>
      </form>
    </div>
  )
}
