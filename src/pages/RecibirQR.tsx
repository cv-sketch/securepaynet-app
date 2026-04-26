import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../store/useAuth'
import { maskCBU } from '../lib/format'

export default function RecibirQR() {
  const { cliente } = useAuth()
  const [monto, setMonto] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const payload = JSON.stringify({
    cvu: cliente?.cvu ?? '',
    alias: cliente?.alias ?? '',
    nombre: cliente?.nombre ?? '',
    monto: monto ? parseFloat(monto) : null,
  })

  const copy = async (text: string, label: string) => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Recibir dinero</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col items-center">
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <QRCodeSVG value={payload} size={200} level="M" />
        </div>
        <div className="mt-3 text-center">
          <div className="text-sm font-semibold">{cliente?.nombre ?? '-'}</div>
          <div className="text-xs text-slate-500 mt-1">Mostra este QR para recibir un pago</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <label className="block text-xs font-semibold text-slate-700 mb-1">Monto a cobrar (opcional)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="0.00"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">CVU</div>
            <div className="font-mono">{maskCBU(cliente?.cvu)}</div>
          </div>
          {cliente?.cvu && (
            <button onClick={() => copy(cliente.cvu!, 'cvu')} className="text-xs text-brand-600 font-semibold">
              {copied === 'cvu' ? 'Copiado' : 'Copiar'}
            </button>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div>
            <div className="text-xs text-slate-500">Alias</div>
            <div className="font-mono">{cliente?.alias ?? '-'}</div>
          </div>
          {cliente?.alias && (
            <button onClick={() => copy(cliente.alias!, 'alias')} className="text-xs text-brand-600 font-semibold">
              {copied === 'alias' ? 'Copiado' : 'Copiar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
