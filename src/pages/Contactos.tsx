// src/pages/Contactos.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { contactosService, type Contacto, type ContactoInput } from '../services/contactosService'
import { lookupService, type LookupOk } from '../services/lookupService'
import { maskCBU } from '../lib/format'
import SecurityGate from '../components/SecurityGate'

export default function Contactos() {
  const { cliente } = useAuth()
  const [contactos, setContactos] = useState<Contacto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [altaOpen, setAltaOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Contacto | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Contacto | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [pendingInput, setPendingInput] = useState<ContactoInput | null>(null)

  async function refresh() {
    if (!cliente?.id) return
    setLoading(true)
    try {
      setContactos(await contactosService.list(cliente.id))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.id])

  async function handleGateSuccess(gateToken: string) {
    setGateOpen(false)
    try {
      if (pendingInput) {
        await contactosService.createGated(pendingInput, gateToken)
        setPendingInput(null)
        setAltaOpen(false)
        await refresh()
      } else if (removeTarget) {
        await contactosService.removeGated(removeTarget.id, gateToken)
        setRemoveTarget(null)
        await refresh()
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Contactos</h1>
        <button
          onClick={() => setAltaOpen(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2 rounded-lg"
        >
          + Agregar
        </button>
      </div>

      {loading && <div className="text-sm text-slate-400">Cargando...</div>}

      {!loading && contactos.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-600 mb-3">Aun no tenes contactos agendados.</p>
          <button
            onClick={() => setAltaOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            Agendar mi primer contacto
          </button>
        </div>
      )}

      {!loading && contactos.length > 0 && (
        <ul className="space-y-2">
          {contactos.map((c) => (
            <li key={c.id} className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold">
                {c.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">
                  {c.favorito && <span className="text-amber-500">* </span>}
                  {c.nombre}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {c.entidad ?? 'Otra entidad'} - {c.alias ?? maskCBU(c.cvu)}
                </div>
              </div>
              <div className="flex gap-1">
                <Link
                  to={`/transferir?contactoId=${c.id}`}
                  className="text-xs font-semibold text-brand-700 hover:bg-brand-50 px-2 py-1 rounded"
                >
                  Enviar
                </Link>
                <button
                  onClick={() => setEditTarget(c)}
                  className="text-xs text-slate-600 hover:bg-slate-50 px-2 py-1 rounded"
                >
                  Editar
                </button>
                <button
                  onClick={() => { setRemoveTarget(c); setGateOpen(true) }}
                  className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

      {altaOpen && (
        <AltaModal
          onClose={() => { setAltaOpen(false); setPendingInput(null) }}
          onConfirm={(input) => { setPendingInput(input); setGateOpen(true) }}
        />
      )}

      {editTarget && (
        <EditModal
          contacto={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await refresh() }}
        />
      )}

      <SecurityGate
        open={gateOpen}
        reason={removeTarget ? 'eliminar contacto' : 'agendar contacto'}
        onClose={() => { setGateOpen(false); setPendingInput(null); setRemoveTarget(null) }}
        onSuccess={handleGateSuccess}
      />
    </div>
  )
}

function AltaModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (input: ContactoInput) => void }) {
  const [tab, setTab] = useState<'cbu' | 'alias'>('cbu')
  const [value, setValue] = useState('')
  const [searching, setSearching] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const [result, setResult] = useState<LookupOk['data'] | null>(null)
  const [apodo, setApodo] = useState('')
  const [favorito, setFavorito] = useState(false)

  async function handleSearch() {
    setLookupErr(null)
    setSearching(true)
    try {
      const r = await lookupService.lookup(tab, value)
      if (!r.ok) {
        setLookupErr(messageForCode(r.code))
        setResult(null)
      } else {
        setResult(r.data)
        setApodo(r.data.nombre)
      }
    } catch (e) {
      setLookupErr((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  function messageForCode(code: string): string {
    switch (code) {
      case 'INVALID_FORMAT': return 'Formato invalido'
      case 'NOT_FOUND': return 'No encontramos esa cuenta'
      case 'ACCOUNT_DISABLED': return 'Esa cuenta no esta disponible'
      default: return 'Error en el servicio. Intenta de nuevo.'
    }
  }

  function handleConfirm() {
    if (!result) return
    const input: ContactoInput = {
      nombre: apodo || result.nombre,
      cvu: result.cvu_completo,
      cuit: result.cuit,
      titular: result.nombre,
      entidad: result.entidad,
      alias: tab === 'alias' ? value : null,
      favorito,
    }
    onConfirm(input)
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-40 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Agregar contacto</h2>
          <button onClick={onClose} className="text-sm text-slate-500">Cerrar</button>
        </div>

        {!result && (
          <>
            <div className="flex bg-slate-100 rounded-lg p-1 mb-3">
              <button
                onClick={() => { setTab('cbu'); setValue(''); setLookupErr(null) }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md ${tab === 'cbu' ? 'bg-white shadow' : 'text-slate-600'}`}
              >
                CBU/CVU
              </button>
              <button
                onClick={() => { setTab('alias'); setValue(''); setLookupErr(null) }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md ${tab === 'alias' ? 'bg-white shadow' : 'text-slate-600'}`}
              >
                Alias
              </button>
            </div>

            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(tab === 'cbu' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              maxLength={tab === 'cbu' ? 22 : 20}
              placeholder={tab === 'cbu' ? '22 digitos' : 'ej: juan.perez'}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-500"
            />

            {lookupErr && <div className="text-xs text-red-600 mt-2">{lookupErr}</div>}

            <button
              onClick={handleSearch}
              disabled={searching || !value}
              className="w-full mt-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
            >
              {searching ? 'Buscando...' : 'Buscar destinatario'}
            </button>
          </>
        )}

        {result && (
          <>
            <div className="bg-slate-50 rounded-xl p-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white font-bold">
                  {result.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{result.nombre}</div>
                  <div className="text-xs text-slate-500">CUIT {result.cuit}</div>
                </div>
              </div>
              <div className="text-xs text-slate-600 mt-2">
                <div><span className="font-semibold">Entidad:</span> {result.entidad}</div>
                <div className="font-mono break-all"><span className="font-semibold">CVU:</span> {result.cvu_completo}</div>
              </div>
            </div>

            <label className="block text-xs font-semibold text-slate-700 mb-1">Apodo (opcional)</label>
            <input
              value={apodo}
              onChange={(e) => setApodo(e.target.value)}
              maxLength={50}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />

            <label className="flex items-center gap-2 mt-3 text-sm">
              <input
                type="checkbox"
                checked={favorito}
                onChange={(e) => setFavorito(e.target.checked)}
              />
              Marcar como favorito
            </label>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setResult(null); setApodo('') }}
                className="flex-1 border border-slate-300 text-slate-700 font-semibold py-2.5 rounded-xl"
              >
                Atras
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl"
              >
                Confirmar y guardar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function EditModal({
  contacto,
  onClose,
  onSaved,
}: {
  contacto: Contacto
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(contacto.nombre)
  const [alias, setAlias] = useState(contacto.alias ?? '')
  const [favorito, setFavorito] = useState(contacto.favorito)
  const [notas, setNotas] = useState(contacto.notas ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      await contactosService.update(contacto.id, {
        nombre,
        alias: alias || null,
        favorito,
        notas: notas || null,
      })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Editar contacto</h2>
          <button onClick={onClose} className="text-sm text-slate-500">Cerrar</button>
        </div>

        <div className="bg-slate-50 rounded-xl p-2 mb-3 text-xs text-slate-600">
          <div><span className="font-semibold">Titular:</span> {contacto.titular ?? '-'}</div>
          <div><span className="font-semibold">CUIT:</span> {contacto.cuit ?? '-'}</div>
          <div><span className="font-semibold">Entidad:</span> {contacto.entidad ?? '-'}</div>
          <div className="font-mono break-all"><span className="font-semibold">CVU:</span> {contacto.cvu ?? '-'}</div>
          <div className="text-[11px] text-slate-400 mt-1">La identidad del destinatario es inmutable. Para cambiarla, borra y agenda de nuevo.</div>
        </div>

        <label className="block text-xs font-semibold text-slate-700 mb-1">Apodo</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-2" />

        <label className="block text-xs font-semibold text-slate-700 mb-1">Alias</label>
        <input value={alias} onChange={(e) => setAlias(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-2" />

        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={favorito} onChange={(e) => setFavorito(e.target.checked)} />
          Favorito
        </label>

        <label className="block text-xs font-semibold text-slate-700 mb-1">Notas</label>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={200} className="w-full border rounded-lg px-3 py-2 text-sm mb-3" rows={2} />

        {err && <div className="text-xs text-red-600 mb-2">{err}</div>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
