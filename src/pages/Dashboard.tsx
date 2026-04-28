import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, formatDateAR, maskCBU } from '../lib/format'
import ComprobanteModal from '../components/ComprobanteModal'
import {
  fetchComprobanteForMovimiento,
  type MovimientoLite,
} from '../lib/movimientoComprobante'
import type { ComprobanteData } from '../lib/comprobantePdf'

export default function Dashboard() {
  const { cliente } = useAuth()
  const [hideBalance, setHideBalance] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [recent, setRecent] = useState<MovimientoLite[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [comp, setComp] = useState<ComprobanteData | null>(null)
  const [compOpen, setCompOpen] = useState(false)

  useEffect(() => {
    if (!cliente?.id) return
    let cancelled = false
    ;(async () => {
      setRecentLoading(true)
      const { data: wallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('cliente_id', cliente.id)
        .maybeSingle()
      if (!wallet || cancelled) {
        if (!cancelled) { setRecent([]); setRecentLoading(false) }
        return
      }
      const { data } = await supabase
        .from('movimientos')
        .select('id, created_at, tipo, monto, descripcion, referencia, estado, transferencia_id')
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false })
        .limit(5)
      if (cancelled) return
      setRecent((data ?? []) as MovimientoLite[])
      setRecentLoading(false)
    })()
    return () => { cancelled = true }
  }, [cliente?.id])

  const onMovTap = async (m: MovimientoLite) => {
    if (m.tipo !== 'debito') return
    const c = await fetchComprobanteForMovimiento(m)
    if (c) { setComp(c); setCompOpen(true) }
  }

  const saldo = Number(cliente?.saldo ?? 0)
  const loading = !cliente

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
        <div className="mt-3 text-xs opacity-80">
          Cuenta en pesos - {cliente?.moneda ?? 'ARS'}
        </div>
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

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-500">MOVIMIENTOS RECIENTES</span>
          <Link to="/movimientos" className="text-xs font-semibold text-brand-600 hover:underline">
            Ver movimientos →
          </Link>
        </div>
        {recentLoading ? (
          <div className="p-6 text-center text-xs text-slate-400">Cargando…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Aún no tenés movimientos.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((m) => {
              const monto = Number(m.monto)
              const isCredito = m.tipo === 'credito'
              const Tag: any = isCredito ? 'div' : 'button'
              return (
                <li key={m.id}>
                  <Tag
                    {...(!isCredito ? { onClick: () => onMovTap(m), type: 'button' } : {})}
                    className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left ${
                      !isCredito ? 'hover:bg-slate-50 cursor-pointer' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">
                        {m.descripcion || (isCredito ? 'Crédito' : 'Débito')}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {isCredito ? 'Recibido' : 'Enviado'} · {formatDateAR(m.created_at)}
                      </div>
                    </div>
                    <div
                      className={`text-sm font-bold whitespace-nowrap ${
                        isCredito ? 'text-emerald-600' : 'text-slate-900'
                      }`}
                    >
                      {isCredito ? '+ ' : '- '}{formatARS(monto)}
                    </div>
                  </Tag>
                </li>
              )
            })}
          </ul>
        )}
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

      <ComprobanteModal
        open={compOpen}
        onClose={() => setCompOpen(false)}
        comprobante={comp}
      />
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