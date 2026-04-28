import { useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, formatDateAR } from '../lib/format'
import ComprobanteModal from '../components/ComprobanteModal'
import {
  fetchComprobanteForMovimiento,
  type MovimientoLite,
} from '../lib/movimientoComprobante'
import type { ComprobanteData } from '../lib/comprobantePdf'
import { generateStatementPdf, statementPdfFilename } from '../lib/statementPdf'
import { buildMovimientosCsv, statementCsvFilename } from '../lib/statementCsv'

type WalletInfo = {
  id: string
  cvu: string | null
  alias: string | null
  saldo: number | string | null
}

export default function Movimientos() {
  const { cliente } = useAuth()
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [items, setItems] = useState<MovimientoLite[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null)
  const [comp, setComp] = useState<ComprobanteData | null>(null)
  const [compOpen, setCompOpen] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!cliente) return
    let cancelled = false
    ;(async () => {
      setLoading(true)

      const { data: w } = await supabase
        .from('wallets')
        .select('id, cvu, alias, saldo')
        .eq('cliente_id', cliente.id)
        .maybeSingle()

      if (!w || cancelled) {
        if (!cancelled) { setItems([]); setWallet(null); setLoading(false) }
        return
      }
      setWallet(w as WalletInfo)

      const { data } = await supabase
        .from('movimientos')
        .select('id, created_at, tipo, monto, descripcion, referencia, estado, transferencia_id')
        .eq('wallet_id', w.id)
        .order('created_at', { ascending: false })
        .limit(200)

      if (cancelled) return
      setItems((data ?? []) as MovimientoLite[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [cliente])

  const onTap = async (m: MovimientoLite) => {
    if (m.tipo !== 'debito') return
    const c = await fetchComprobanteForMovimiento(m)
    if (c) { setComp(c); setCompOpen(true) }
  }

  const downloadPdf = async () => {
    if (!cliente || !wallet || items.length === 0) return
    setBusy('pdf'); setHint(null)
    try {
      const blob = await generateStatementPdf({
        cliente: {
          nombre: cliente.nombre,
          apellido: cliente.apellido,
          cuit: cliente.cuit,
          email: cliente.email,
        },
        wallet: { cvu: wallet.cvu, alias: wallet.alias, saldo: wallet.saldo },
        rows: items,
      })
      triggerDownload(blob, statementPdfFilename())
    } catch (e) {
      console.error('[Movimientos] pdf error:', e)
      setHint('No se pudo generar el PDF')
    } finally {
      setBusy(null)
    }
  }

  const downloadCsv = async () => {
    if (items.length === 0) return
    setBusy('csv'); setHint(null)
    try {
      const blob = buildMovimientosCsv(items)
      triggerDownload(blob, statementCsvFilename())
    } catch (e) {
      console.error('[Movimientos] csv error:', e)
      setHint('No se pudo generar el CSV')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Movimientos</h1>
        <span className="text-xs text-slate-500">
          {loading ? '' : `${items.length} ${items.length === 1 ? 'registro' : 'registros'}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={downloadPdf}
          disabled={busy !== null || loading || items.length === 0}
          className="bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {busy === 'pdf' ? 'Generando…' : 'Descargar Statement'}
        </button>
        <button
          onClick={downloadCsv}
          disabled={busy !== null || loading || items.length === 0}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/>
            <line x1="8" y1="17" x2="16" y2="17"/>
          </svg>
          {busy === 'csv' ? 'Generando…' : 'Descargar CSV'}
        </button>
      </div>

      {hint && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 text-center">
          {hint}
        </p>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-10">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Aún no tenés movimientos.
        </div>
      ) : (
        <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {items.map((m) => {
            const monto = Number(m.monto)
            const isCredito = m.tipo === 'credito'
            const Tag: any = isCredito ? 'div' : 'button'
            return (
              <li key={m.id}>
                <Tag
                  {...(!isCredito ? { onClick: () => onTap(m), type: 'button' } : {})}
                  className={`w-full p-3 flex items-center justify-between gap-3 text-left ${
                    !isCredito ? 'hover:bg-slate-50 cursor-pointer' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                      {m.descripcion || (isCredito ? 'Crédito' : 'Débito')}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {isCredito ? 'Recibido' : 'Enviado'} · {formatDateAR(m.created_at)}
                      {m.referencia ? ` · ref ${String(m.referencia).slice(0, 12)}` : ''}
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

      <ComprobanteModal
        open={compOpen}
        onClose={() => setCompOpen(false)}
        comprobante={comp}
      />
    </div>
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
