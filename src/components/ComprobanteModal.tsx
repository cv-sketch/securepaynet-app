import { useState } from 'react'
import { formatARS, formatDateAR } from '../lib/format'
import {
  generateComprobantePdf,
  generateComprobanteImage,
  comprobanteFilename,
  type ComprobanteData,
} from '../lib/comprobantePdf'

type Props = {
  open: boolean
  onClose: () => void
  comprobante: ComprobanteData | null
  onNewTransfer?: () => void
}

export default function ComprobanteModal({ open, onClose, comprobante, onNewTransfer }: Props) {
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  if (!open || !comprobante) return null

  const handleDownloadPdf = async () => {
    setBusy('pdf'); setHint(null)
    try {
      const blob = await generateComprobantePdf(comprobante)
      triggerDownload(blob, comprobanteFilename(comprobante, 'pdf'))
    } catch {
      setHint('No se pudo generar el PDF')
    } finally {
      setBusy(null)
    }
  }

  const handleShare = async () => {
    setBusy('share'); setHint(null)
    try {
      // Generamos la imagen programaticamente (Canvas 2D), no html2canvas.
      // Tamano controlado, sin riesgo de layout corrompido o "explotado".
      const blob = await generateComprobanteImage(comprobante)

      const filename = comprobanteFilename(comprobante, 'png')
      const file = new File([blob], filename, { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }

      // 1) Web Share API con archivo (mobile: WhatsApp, Telegram, Mail, etc.)
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        try {
          await nav.share({
            files: [file],
            title: 'Comprobante SecurePayNet',
            text: `Comprobante por ${formatARS(comprobante.monto)} — ${formatDateAR(comprobante.fecha)}`,
          })
          return
        } catch (err: any) {
          if (err?.name === 'AbortError') return
          // Sigue al fallback
        }
      }

      // 2) Clipboard API — copiar la imagen al portapapeles. El usuario
      //    luego pega (Ctrl/Cmd+V) directamente en WhatsApp Web.
      try {
        if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          setHint('Imagen copiada. Pegala (Ctrl/Cmd+V) en WhatsApp.')
          return
        }
      } catch {
        // sigue al fallback de descarga
      }

      // 3) Ultimo recurso: descargar imagen + abrir WhatsApp con texto.
      triggerDownload(blob, filename)
      const text = encodeURIComponent(
        `Comprobante SecurePayNet por ${formatARS(comprobante.monto)} (${formatDateAR(comprobante.fecha)}). Adjunto la imagen.`
      )
      window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener')
      setHint('Imagen descargada. Adjuntala manualmente en WhatsApp.')
    } catch {
      setHint('No se pudo compartir')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Comprobante</h2>
          <button
            onClick={onClose}
            className="text-slate-400 text-2xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Tarjeta capturable: sólo este bloque va al PNG/share */}
        <div className="bg-white">
          <div className="text-center mb-5 pb-5 border-b border-dashed">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-xs text-slate-500">Operación exitosa</div>
            <div className="text-2xl font-bold mt-1">
              {formatARS(comprobante.monto)}
            </div>
          </div>

          <dl className="text-sm space-y-3">
            <Row label="Tipo" value={comprobante.tipo} />
            <Row label="Fecha" value={formatDateAR(comprobante.fecha)} />
            {comprobante.numero && (
              <Row label="Número" value={comprobante.numero} />
            )}
            {comprobante.contraparte && (
              <Row label="Destinatario" value={comprobante.contraparte} />
            )}
            {comprobante.cbu_contraparte && (
              <Row
                label="CBU/CVU destino"
                value={comprobante.cbu_contraparte}
                mono
              />
            )}
            {comprobante.referencia && (
              <Row label="ID Coelsa" value={comprobante.referencia} mono />
            )}
            {comprobante.estado && (
              <Row label="Estado" value={comprobante.estado} />
            )}
            <Row label="Banco" value="Banco de Comercio" />
          </dl>
        </div>

        <div className="space-y-2 mt-5">
          <button
            onClick={handleShare}
            disabled={busy !== null}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            {busy === 'share' ? 'Preparando imagen…' : 'Compartir (WhatsApp, etc.)'}
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={busy !== null}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {busy === 'pdf' ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>

        {onNewTransfer && (
          <button
            onClick={onNewTransfer}
            className="mt-3 w-full border-2 border-brand-600 text-brand-700 hover:bg-brand-50 font-semibold py-2.5 rounded-lg"
          >
            Hacer otra transferencia
          </button>
        )}

        <button
          onClick={onClose}
          className="mt-3 w-full text-xs text-slate-500 hover:underline py-2"
        >
          Cerrar
        </button>

        {hint && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 text-center mt-3">
            {hint}
          </p>
        )}

        <p className="text-[10px] text-slate-400 text-center mt-3">
          Este comprobante es un respaldo digital de la operación. Conservalo
          para tus registros.
        </p>
      </div>
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

function Row({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`font-medium text-right break-all ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
