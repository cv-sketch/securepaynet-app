// src/pages/Transferir.tsx
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { supabase } from '../lib/supabase'
import { formatARS, maskCBU } from '../lib/format'
import ComprobanteModal from '../components/ComprobanteModal'
import { contactosService, type Contacto } from '../services/contactosService'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('VAR')
  const [descripcion, setDescripcion] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [comprobanteOpen, setComprobanteOpen] = useState(false)
  const [comprobanteData, setComprobanteData] = useState<ComprobanteUI | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contactos, setContactos] = useState<Contacto[]>([])
  const [contactoSel, setContactoSel] = useState<Contacto | null>(null)

  useEffect(() => {
    if (!cliente?.id) return
    contactosService
      .list(cliente.id)
      .then(setContactos)
      .catch((e) => console.error('[Transferir] contactos load error:', e))
  }, [cliente?.id])

  useEffect(() => {
    const id = searchParams.get('contactoId')
    if (!id || contactos.length === 0) return
    const c = contactos.find((x) => x.id === id)
    if (c) setContactoSel(c)
  }, [searchParams, contactos])

  function clearContacto() {
    setContactoSel(null)
    setMsg(null)
    if (searchParams.get('contactoId')) {
      const next = new URLSearchParams(searchParams)
      next.delete('contactoId')
      setSearchParams(next, { replace: true })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)

    if (!cliente) {
      setMsg({ ok: false, text: 'No se pudo cargar tu wallet. Recarga la pagina.' })
      return
    }
    if (!contactoSel) {
      setMsg({ ok: false, text: 'Elegi un contacto de la agenda' })
      return
    }
    if (!contactoSel.cvu || !contactoSel.cuit) {
      setMsg({ ok: false, text: 'El contacto no tiene CVU/CUIT validos. Borralo y agendalo de nuevo.' })
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

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('transferencia-execute', {
        body: {
          cbu_destino: contactoSel.cvu,
          cuit_destino: contactoSel.cuit,
          monto: m,
          concepto,
          descripcion: descripcion || null,
        },
      })

      if (error) {
        setMsg({ ok: false, text: 'Error: ' + (error.message || 'desconocido') })
        return
      }
      if (!data?.ok) {
        setMsg({ ok: false, text: data?.message || 'Error en la transferencia' })
        return
      }

      const comp = data.comprobante
      if (comp) {
        const compUI: ComprobanteUI = {
          id: comp.id,
          numero: comp.numero ?? null,
          fecha: comp.created_at,
          tipo: 'Transferencia enviada',
          monto: m,
          contraparte: comp.titular_destino ?? contactoSel.titular ?? contactoSel.nombre,
          cbu_contraparte: comp.cvu_destino ?? contactoSel.cvu,
          referencia: data.coelsa_id ?? data.origin_id ?? null,
          estado: 'completado',
        }
        setComprobanteData(compUI)
        setComprobanteOpen(true)
      }

      setMsg({ ok: true, text: 'Transferencia enviada. Comprobante generado.' })
      setMonto('')
      setDescripcion('')
      await hydrate()
    } catch (err) {
      console.error('[Transferir] error:', err)
      setMsg({ ok: false, text: 'Error: ' + (err as Error).message })
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

      <div className="mb-4">
        {contactoSel ? (
          <div className="bg-brand-50 border border-brand-100 rounded-2xl p-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white font-bold">
                {contactoSel.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{contactoSel.nombre}</div>
                <div className="text-xs text-slate-500 truncate">
                  {contactoSel.entidad ?? 'Otra entidad'} - {contactoSel.alias ?? maskCBU(contactoSel.cvu)}
                </div>
                {contactoSel.cuit && <div className="text-[11px] text-slate-400">CUIT {contactoSel.cuit}</div>}
              </div>
              <button
                type="button"
                onClick={clearContacto}
                className="text-xs text-brand-700 font-semibold px-2 py-1 hover:bg-white rounded"
              >
                Cambiar
              </button>
            </div>
          </div>
        ) : contactos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-sm text-slate-600 mb-3">
              Aun no tenes contactos. Solo se puede transferir a contactos previamente agendados.
            </p>
            <Link
              to="/contactos"
              className="inline-block bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Agendar mi primer contacto
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full bg-white border border-dashed border-slate-300 hover:border-brand-500 hover:bg-brand-50 text-sm text-slate-600 hover:text-brand-700 font-semibold py-3 rounded-2xl"
          >
            Elegir contacto de la agenda
          </button>
        )}
      </div>

      {contactoSel && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4"
        >
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Descripcion (opcional)</label>
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
              className={`text-xs rounded-lg p-2 border ${msg.ok
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
            Operaciones sujetas a normativa BCRA. Solo se puede transferir a contactos agendados.
          </p>
        </form>
      )}

      <ComprobanteModal
        open={comprobanteOpen}
        onClose={() => {
          setComprobanteOpen(false)
          // Limpiar el mensaje de exito para que el form quede listo y el
          // boton "Enviar transferencia" no quede empujado fuera de la vista.
          if (msg?.ok) setMsg(null)
        }}
        comprobante={comprobanteData}
      />

      {pickerOpen && (
        <ContactoPicker
          contactos={contactos}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => { setContactoSel(c); setPickerOpen(false); setMsg(null) }}
        />
      )}
    </div>
  )
}

function ContactoPicker({
  contactos,
  onClose,
  onPick,
}: {
  contactos: Contacto[]
  onClose: () => void
  onPick: (c: Contacto) => void
}) {
  const [q, setQ] = useState('')
  const filtered = contactos.filter((c) => {
    if (!q.trim()) return true
    const s = q.toLowerCase()
    return (
      c.nombre.toLowerCase().includes(s) ||
      (c.alias?.toLowerCase().includes(s) ?? false) ||
      (c.cvu?.includes(s) ?? false) ||
      (c.titular?.toLowerCase().includes(s) ?? false)
    )
  })
  const favoritos = filtered.filter((c) => c.favorito)
  const resto = filtered.filter((c) => !c.favorito)

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Elegir contacto</h2>
          <button onClick={onClose} className="text-sm text-slate-500 px-2 py-1">
            Cerrar
          </button>
        </div>

        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, alias o CVU"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mb-3 focus:ring-2 focus:ring-brand-500 outline-none"
        />

        {filtered.length === 0 && (
          <div className="text-center text-sm text-slate-500 py-8">Sin resultados.</div>
        )}

        {favoritos.length > 0 && (
          <div className="mb-2">
            <div className="text-[11px] uppercase font-semibold text-slate-400 mb-1 px-1">Favoritos</div>
            <div className="space-y-1">
              {favoritos.map((c) => <ContactoRow key={c.id} c={c} onPick={onPick} />)}
            </div>
          </div>
        )}

        {resto.length > 0 && (
          <div>
            {favoritos.length > 0 && (
              <div className="text-[11px] uppercase font-semibold text-slate-400 mb-1 px-1">Todos</div>
            )}
            <div className="space-y-1">
              {resto.map((c) => <ContactoRow key={c.id} c={c} onPick={onPick} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ContactoRow({ c, onPick }: { c: Contacto; onPick: (c: Contacto) => void }) {
  return (
    <button
      onClick={() => onPick(c)}
      className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50"
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-sm font-bold flex-shrink-0">
        {c.nombre.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-800 truncate">
          {c.favorito && <span className="text-amber-500">* </span>}{c.nombre}
        </div>
        <div className="text-xs text-slate-500 truncate">
          {c.entidad ?? 'Otra entidad'} - {c.alias ?? maskCBU(c.cvu)}
        </div>
      </div>
    </button>
  )
}
