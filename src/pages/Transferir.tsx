import { useState, useEffect } from 'react'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS } from '../lib/format'
import { bdcService } from '../services/bdcService'
import ComprobanteModal from '../components/ComprobanteModal'

type ComprobanteUI = {
  id: string
  numero: string | null
  fecha: string
  tipo: string
  monto: number
  contraparte: string | null
  cbu_contraparte: string | null
  referencia: string | null
  estado: string | null
}

export default function Transferir() {
  const { cliente, hydrate } = useAuth()
  const [destino, setDestino] = useState('')
  const [destinoCuit, setDestinoCuit] = useState('')
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('VAR')
  const [descripcion, setDescripcion] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [walletId, setWalletId] = useState<string | null>(null)
  const [walletCvu, setWalletCvu] = useState<string | null>(null)
  const [comprobanteOpen, setComprobanteOpen] = useState(false)
  const [comprobanteData, setComprobanteData] = useState<ComprobanteUI | null>(null)

  // Cargar wallet del cliente actual
  useEffect(() => {
    if (!cliente) return
    ;(async () => {
      const { data } = await supabase
        .from('wallets')
        .select('id, cvu')
        .eq('cliente_id', cliente.id)
        .maybeSingle()
      if (data) {
        setWalletId(data.id)
        setWalletCvu(data.cvu)
      }
    })()
  }, [cliente])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!cliente || !walletId || !walletCvu) {
      setMsg({ ok: false, text: 'No se pudo cargar tu wallet. Recarga la pagina.' })
      return
    }
    const m = parseFloat(monto)
    if (isNaN(m) || m <= 0) {
      setMsg({ ok: false, text: 'Ingresa un monto valido' })
      return
    }
    if (m > Number(cliente.saldo ?? 0)) {
      setMsg({ ok: false, text: 'Saldo insuficiente' })
      return
    }
    if (!destino || destino.length < 6) {
      setMsg({ ok: false, text: 'Ingresa un CVU, CBU o alias valido' })
      return
    }

    setLoading(true)
    try {
      const originId = 'trx-' + Date.now()
      const titularOrigen = `${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim() || '—'

      // 1. Llamar al servicio BDC
      const res = await bdcService.enviarTransferencia({
        originId,
        fromAddress: walletCvu,
        fromCuit: cliente.cuit ?? '',
        toAddress: destino,
        toCuit: destinoCuit,
        amount: m,
        concept: concepto,
        description: descripcion,
      })

      if (!res.ok) {
        setMsg({ ok: false, text: res.message || 'Error en la transferencia' })
        setLoading(false)
        return
      }

      // 2. Buscar wallet destino interna (si existe)
      const { data: walletDest } = await supabase
        .from('wallets')
        .select('id, cvu, alias, saldo, cliente_id, titular')
        .or(`cvu.eq.${destino},alias.eq.${destino}`)
        .maybeSingle()

      const titularDestino = walletDest?.titular || '—'

      // 3. INSERT transferencia
      const { data: trxRow, error: trxErr } = await supabase
        .from('transferencias')
        .insert({
          origin_id: originId,
          wallet_origen_id: walletId,
          wallet_destino_id: walletDest?.id ?? null,
          from_cvu: walletCvu,
          from_cuit: cliente.cuit ?? null,
          to_address: destino,
          to_cuit: destinoCuit || null,
          monto: m,
          moneda: 'ARS',
          concepto,
          descripcion: descripcion || null,
          coelsa_id: res.coelsaId ?? null,
          referencia: res.coelsaId ?? null,
          estado: 'completada',
          tipo: concepto,
        })
        .select()
        .single()
      if (trxErr) throw trxErr

      // 4. UPDATE saldo origen (debito)
      const saldoAnteriorOrigen = Number(cliente.saldo ?? 0)
      const saldoPosteriorOrigen = saldoAnteriorOrigen - m
      const { error: updOrigenErr } = await supabase
        .from('wallets')
        .update({ saldo: saldoPosteriorOrigen })
        .eq('id', walletId)
      if (updOrigenErr) throw updOrigenErr

      // 5. INSERT movimiento debito
      const { error: movDebErr } = await supabase.from('movimientos').insert({
        wallet_id: walletId,
        cvu: walletCvu,
        tipo: 'debito',
        monto: m,
        saldo_anterior: saldoAnteriorOrigen,
        saldo_posterior: saldoPosteriorOrigen,
        descripcion: descripcion || `Transferencia a ${destino.slice(0, 14)}... (${concepto})`,
        estado: 'completado',
        referencia: res.coelsaId ?? originId,
        transferencia_id: trxRow.id,
      })
      if (movDebErr) throw movDebErr

      // 6. Si destino es interno: UPDATE saldo destino + INSERT movimiento credito
      if (walletDest) {
        const saldoAntDest = Number(walletDest.saldo ?? 0)
        const saldoPostDest = saldoAntDest + m
        await supabase
          .from('wallets')
          .update({ saldo: saldoPostDest })
          .eq('id', walletDest.id)
        await supabase.from('movimientos').insert({
          wallet_id: walletDest.id,
          cvu: walletDest.cvu,
          tipo: 'credito',
          monto: m,
          saldo_anterior: saldoAntDest,
          saldo_posterior: saldoPostDest,
          descripcion:
            descripcion ||
            `Transferencia recibida de ${walletCvu.slice(-8)} (${concepto})`,
          estado: 'completado',
          referencia: res.coelsaId ?? originId,
          transferencia_id: trxRow.id,
        })
      }

      // 7. INSERT comprobante (solo para la operacion saliente)
      const { data: compRow, error: compErr } = await supabase
        .from('comprobantes')
        .insert({
          transferencia_id: trxRow.id,
          wallet_origen_id: walletId,
          wallet_destino_id: walletDest?.id ?? null,
          cliente_id: cliente.id,
          titular_origen: titularOrigen,
          cuit_origen: cliente.cuit ?? null,
          cvu_origen: walletCvu,
          titular_destino: titularDestino,
          cuit_destino: destinoCuit || null,
          cvu_destino: destino,
          monto: m,
          moneda: 'ARS',
          concepto,
          descripcion: descripcion || null,
          coelsa_id: res.coelsaId ?? null,
          origin_id: originId,
          saldo_anterior: saldoAnteriorOrigen,
          saldo_posterior: saldoPosteriorOrigen,
          banco: 'Banco de Comercio',
          payload: {
            origen: {
              titular: titularOrigen,
              cuit: cliente.cuit,
              cvu: walletCvu,
              walletId,
            },
            destino: {
              titular: titularDestino,
              cuit: destinoCuit,
              cvu: destino,
              interna: !!walletDest,
            },
            operacion: {
              monto: m,
              moneda: 'ARS',
              concepto,
              descripcion,
              coelsaId: res.coelsaId,
              originId,
            },
            saldos: { anterior: saldoAnteriorOrigen, posterior: saldoPosteriorOrigen },
            timestamp: new Date().toISOString(),
          },
        })
        .select()
        .single()
      if (compErr) throw compErr

      // 8. Mostrar comprobante al usuario
      const compUI: ComprobanteUI = {
        id: compRow.id,
        numero: compRow.numero ?? null,
        fecha: compRow.created_at,
        tipo: 'Transferencia enviada',
        monto: m,
        contraparte: titularDestino,
        cbu_contraparte: destino,
        referencia: res.coelsaId ?? originId,
        estado: 'completado',
      }
      setComprobanteData(compUI)
      setComprobanteOpen(true)

      // 9. Reset form + refrescar saldo
      setMsg({ ok: true, text: 'Transferencia enviada. Comprobante generado.' })
      setDestino('')
      setDestinoCuit('')
      setMonto('')
      setDescripcion('')
      await hydrate()
    } catch (err: any) {
      console.error('[Transferir] error:', err)
      setMsg({ ok: false, text: 'Error: ' + (err?.message || String(err)) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Transferir</h1>

      {cliente && (
        <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">Saldo disponible</span>
          <span className="text-sm font-bold">{formatARS(Number(cliente.saldo ?? 0))}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4"
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            CVU, CBU o alias destino
          </label>
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
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            CUIT del destinatario (opcional)
          </label>
          <input
            type="text"
            value={destinoCuit}
            onChange={(e) => setDestinoCuit(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="20-12345678-9"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Monto (ARS)
          </label>
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
            <div className="text-xs text-slate-500 mt-1">
              {formatARS(parseFloat(monto))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Concepto</label>
          <select
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="VAR">VAR - Varios</option>
            <option value="ALQ">ALQ - Alquiler</option>
            <option value="CUO">CUO - Cuota</option>
            <option value="HAB">HAB - Haberes</option>
            <option value="HON">HON - Honorarios</option>
            <option value="FAC">FAC - Factura</option>
            <option value="PRE">PRE - Prestamo</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Descripcion (opcional)
          </label>
          <input
            type="text"
            maxLength={80}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Ej: pago alquiler"
          />
        </div>

        {msg && (
          <div
            className={`text-xs rounded-lg p-2 border ${
              msg.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-600'
            }`}
          >
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

      <ComprobanteModal
        open={comprobanteOpen}
        onClose={() => setComprobanteOpen(false)}
        comprobante={comprobanteData}
      />
    </div>
  )
}