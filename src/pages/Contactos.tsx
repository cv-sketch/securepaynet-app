import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { contactosService, type Contacto, type ContactoInput } from '../services/contactosService'
import { maskCBU } from '../lib/format'

export default function Contactos() {
  const { cliente } = useAuth()
  const nav = useNavigate()
  const [items, setItems] = useState<Contacto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Contacto | 'new' | null>(null)

  useEffect(() => {
    if (cliente?.id) refresh(cliente.id)
  }, [cliente?.id])

  async function refresh(clienteId: string) {
    setLoading(true)
    setError(null)
    try {
      const data = await contactosService.list(clienteId)
      setItems(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando contactos')
    } finally {
      setLoading(false)
    }
  }

  const filtered = items.filter((c) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.alias?.toLowerCase().includes(q) ?? false) ||
      (c.cvu?.includes(q) ?? false) ||
      (c.titular?.toLowerCase().includes(q) ?? false)
    )
  })

  const handleSelect = (c: Contacto) => {
    nav(`/transferir?contactoId=${c.id}`)
  }

  const handleToggleFav = async (c: Contacto) => {
    try {
      await contactosService.toggleFavorito(c.id, !c.favorito)
      if (cliente?.id) refresh(cliente.id)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    }
  }

  const handleDelete = async (c: Contacto) => {
    if (!window.confirm(`Eliminar a "${c.nombre}" de tus contactos?`)) return
    try {
      await contactosService.remove(c.id)
      if (cliente?.id) refresh(cliente.id)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    }
  }

  const handleSave = async (input: ContactoInput, existing: Contacto | null) => {
    if (!cliente?.id) return
    try {
      if (existing) await contactosService.update(existing.id, input)
      else await contactosService.create(cliente.id, input)
      setEditing(null)
      refresh(cliente.id)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error guardando contacto')
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Contactos</h1>
        <button
          onClick={() => setEditing('new')}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"
        >
          + Nuevo
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre, alias o CVU"
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
      />

      {loading && (
        <div className="text-center text-sm text-slate-500 py-8">Cargando...</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs p-3 rounded-lg">
          {error}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center text-sm text-slate-500 py-12 bg-white rounded-2xl border border-slate-200">
          {search
            ? 'Sin resultados.'
            : 'Aun no tienes contactos. Agrega tu primer destinatario.'}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center gap-3"
          >
            <button
              onClick={() => handleSelect(c)}
              className="flex-1 text-left min-w-0"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 truncate">{c.nombre}</span>
                {c.favorito && <span className="text-amber-500 text-xs">FAV</span>}
                {c.banco && (
                  <span className="text-[10px] uppercase text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    {c.banco}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 font-mono truncate">
                {c.alias ? c.alias : maskCBU(c.cvu)}
              </div>
              {c.titular && c.titular !== c.nombre && (
                <div className="text-[11px] text-slate-400 truncate">
                  Titular: {c.titular}
                </div>
              )}
            </button>
            <div className="flex flex-col gap-1 text-xs">
              <button
                onClick={() => handleToggleFav(c)}
                className={`px-2 py-1 rounded ${c.favorito ? 'text-amber-600 bg-amber-50' : 'text-slate-400 hover:bg-slate-100'}`}
                title={c.favorito ? 'Quitar favorito' : 'Marcar favorito'}
              >
                {c.favorito ? 'Fav' : 'Fav?'}
              </button>
              <button
                onClick={() => setEditing(c)}
                className="px-2 py-1 rounded text-slate-600 hover:bg-slate-100"
                title="Editar"
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(c)}
                className="px-2 py-1 rounded text-red-600 hover:bg-red-50"
                title="Borrar"
              >
                Borrar
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-400 text-center pt-2">
        Tus contactos se guardan cifrados en tu cuenta. Solo vos los ves.
      </p>

      {editing !== null && (
        <ContactoForm
          contacto={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

function ContactoForm({
  contacto,
  onClose,
  onSave,
}: {
  contacto: Contacto | null
  onClose: () => void
  onSave: (input: ContactoInput, existing: Contacto | null) => void
}) {
  const [nombre, setNombre] = useState(contacto?.nombre ?? '')
  const [alias, setAlias] = useState(contacto?.alias ?? '')
  const [cvu, setCvu] = useState(contacto?.cvu ?? '')
  const [cuit, setCuit] = useState(contacto?.cuit ?? '')
  const [titular, setTitular] = useState(contacto?.titular ?? '')
  const [banco, setBanco] = useState(contacto?.banco ?? '')
  const [email, setEmail] = useState(contacto?.email ?? '')
  const [telefono, setTelefono] = useState(contacto?.telefono ?? '')
  const [favorito, setFavorito] = useState(contacto?.favorito ?? false)
  const [notas, setNotas] = useState(contacto?.notas ?? '')
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const n = nombre.trim()
    if (!n) return setErr('El nombre es obligatorio')
    if (!alias.trim() && !cvu.trim()) return setErr('Ingresa al menos un alias o un CVU/CBU')
    if (cvu && cvu.length !== 22) return setErr('CVU/CBU debe tener 22 digitos')
    if (cuit && cuit.length !== 11) return setErr('CUIT debe tener 11 digitos')

    onSave(
      {
        nombre: n,
        alias: alias.trim() || null,
        cvu: cvu.trim() || null,
        cuit: cuit.trim() || null,
        titular: titular.trim() || null,
        banco: banco.trim() || null,
        email: email.trim() || null,
        telefono: telefono.trim() || null,
        favorito,
        notas: notas.trim() || null,
      },
      contacto,
    )
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-t-2xl md:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-bold text-lg">
          {contacto ? 'Editar contacto' : 'Nuevo contacto'}
        </h2>

        <Field label="Nombre / apodo *" value={nombre} onChange={setNombre} required />
        <Field
          label="Alias bancario"
          value={alias}
          onChange={setAlias}
          placeholder="ej: juan.perez.mp"
          mono
        />
        <Field
          label="CVU / CBU (22 dig)"
          value={cvu}
          onChange={(v) => setCvu(v.replace(/\D/g, '').slice(0, 22))}
          maxLength={22}
          mono
        />
        <Field
          label="CUIT / CUIL (11 dig)"
          value={cuit}
          onChange={(v) => setCuit(v.replace(/\D/g, '').slice(0, 11))}
          maxLength={11}
          mono
        />
        <Field
          label="Titular (nombre completo)"
          value={titular}
          onChange={setTitular}
          placeholder="Como figura en su cuenta"
        />
        <Field label="Banco" value={banco} onChange={setBanco} placeholder="ej: BDC" />
        <Field label="Email" value={email} onChange={setEmail} type="email" />
        <Field label="Telefono" value={telefono} onChange={setTelefono} type="tel" />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={favorito}
            onChange={(e) => setFavorito(e.target.checked)}
          />
          Marcar como favorito
        </label>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs p-2 rounded-lg">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-slate-300 text-slate-700 py-2.5 rounded-lg font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-lg font-semibold"
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  mono,
  ...rest
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}
