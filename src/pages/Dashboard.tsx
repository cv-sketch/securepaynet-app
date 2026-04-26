import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, maskCBU } from '../lib/format'

export default function Dashboard() {
  const { cliente } = useAuth()
  const [saldo, setSaldo] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [hideBalance, setHideBalance] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!cliente) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('saldos')
        .select('saldo')
        .eq('cliente_id', cliente.id)
        .maybeSingle()
      setSaldo(Number(data?.saldo ?? 0))
      setLoading(false)
    })()
  }, [cliente])

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-br from-brand-600 to-brand-700 text-white rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs opacity-80">Saldo disponible</span>
          <button
            onClick={() => setHideBalance((v) => !v)}
            className="text-xs bg-white/15 px-2 py-0.5 rounded"
          >
            {hideBalance ? 'Ver' : 'Ocultar'}
          </button>
        </div>
        <div className="text-3xl font-bold">
          {loading ? '...' : hideBalance ? '$ ******' : formatARS(saldo)}
        </div>
        <div className="mt-3 text-xs opacity-80">Cuenta en pesos - ARS</div>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
        <div>
          <div className="text-xs text-slate-500">CVU</div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">{maskCBU(cliente?.cvu)}</span>
            {cliente?.cvu && (
              <button
                onClick={() => copy(cliente.cvu!, 'cvu')}
                className="text-xs text-brand-600 font-semibold"
              >
                {copied === 'cvu' ? 'Copiado' : 'Copiar'}
              </button>
            )}
          </div>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs text-slate-500">Alias</div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">{cliente?.alias ?? '-'}</span>
            {cliente?.alias && (
              <button
                onClick={() => copy(cliente.alias!, 'alias')}
                className="text-xs text-brand-600 font-semibold"
              >
                {copied === 'alias' ? 'Copiado' : 'Copiar'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Action to="/transferir" label="Transferir" />
        <Action to="/recibir" label="Recibir" />
        <Action to="/servicios" label="Servicios" />
        <Action to="/movimientos" label="Movim." />
      </div>

      <div className="bg-white rounded-2xl p-4 border border-slate-200">
        <div className="text-xs font-semibold text-slate-500 mb-3">PROXIMAMENTE</div>
        <div className="grid grid-cols-3 gap-2">
          <Tile to="/tarjetas" label="Tarjetas" />
          <Tile to="/inversiones" label="Inversiones" />
          <Tile to="/prestamos" label="Prestamos" />
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-slate-200">
        <div className="text-xs font-semibold text-slate-500 mb-3">MAS</div>
        <div className="grid grid-cols-3 gap-2">
          <Tile to="/comprobantes" label="Comprobantes" />
          <Tile to="/seguridad" label="Seguridad" />
          <Tile to="/soporte" label="Soporte" />
          <Tile to="/legales" label="Legales" />
        </div>
      </div>
    </div>
  )
}

function Action({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center bg-white border border-slate-200 rounded-xl p-3 hover:bg-slate-50"
    >
      <span className="text-xs font-semibold text-slate-700">{label}</span>
    </Link>
  )
}

function Tile({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-xl p-3"
    >
      <span className="text-xs text-slate-600">{label}</span>
    </Link>
  )
}