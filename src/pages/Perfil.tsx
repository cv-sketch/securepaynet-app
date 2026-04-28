import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { maskCBU } from '../lib/format'
import { passkeyService, type Passkey } from '../services/passkeyService'

export default function Perfil() {
  const { user, cliente, signOut } = useAuth()

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Mi perfil</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-sm">
        <Row label="Nombre" value={cliente?.nombre ?? '-'} />
        <Row label="Email" value={user?.email ?? '-'} />
        <Row label="CUIT/CUIL" value={cliente?.cuit ?? '-'} />
        <Row label="CVU" value={maskCBU(cliente?.cvu)} mono />
        <Row label="Alias" value={cliente?.alias ?? '-'} mono />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 text-sm">
        <Item to="/seguridad" icon="Seg" label="Seguridad" />
        <Item to="/comprobantes" icon="Comp" label="Mis comprobantes" />
        <Item to="/soporte" icon="Sop" label="Soporte" />
        <Item to="/legales" icon="Leg" label="Legales y normativa" />
      </div>

      <PasskeysSection />

      <button
        onClick={() => signOut()}
        className="w-full bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold py-3 rounded-xl"
      >
        Cerrar sesion
      </button>

      <p className="text-[11px] text-slate-400 text-center pt-2">
        SecurePayNet S.A. - PSPCP registrado en BCRA - CUIT XX-XXXXXXXX-X
      </p>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-right break-all ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</span>
    </div>
  )
}

function Item({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link to={to} className="flex items-center justify-between p-3 hover:bg-slate-50">
      <div className="flex items-center gap-3">
        <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{icon}</span>
        <span>{label}</span>
      </div>
      <span className="text-slate-300">{'>'}</span>
    </Link>
  )
}

function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const supported = passkeyService.isWebAuthnSupported()

  async function refresh() {
    setLoading(true)
    try {
      setPasskeys(await passkeyService.list())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  async function handleRegister() {
    setErr(null)
    setRegistering(true)
    try {
      await passkeyService.registerCurrentDevice()
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRegistering(false)
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Eliminar este dispositivo? Vas a tener que usar contrasena la proxima vez.')) return
    try {
      await passkeyService.remove(id)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4">
      <h2 className="text-sm font-bold mb-1">Dispositivos confiables (Passkeys)</h2>
      <p className="text-xs text-slate-500 mb-3">
        Permite confirmar operaciones sensibles con tu huella, Face ID o PIN del dispositivo, sin escribir la contrasena.
      </p>

      {!supported && (
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
          Tu navegador no soporta passkeys.
        </div>
      )}

      {supported && loading && <div className="text-xs text-slate-400">Cargando...</div>}

      {supported && !loading && passkeys.length === 0 && (
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 mb-3">
          No tenes passkeys registradas. Te vamos a pedir contrasena en cada operacion sensible.
        </div>
      )}

      {supported && passkeys.length > 0 && (
        <ul className="space-y-2 mb-3">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between border border-slate-100 rounded-lg p-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{p.device_name ?? 'Dispositivo'}</div>
                <div className="text-[11px] text-slate-500">
                  Registrado {new Date(p.created_at).toLocaleDateString('es-AR')}
                  {p.last_used_at ? ` · Ultimo uso ${new Date(p.last_used_at).toLocaleDateString('es-AR')}` : ''}
                </div>
              </div>
              <button
                onClick={() => handleRemove(p.id)}
                className="text-xs text-red-600 font-semibold px-2 py-1 hover:bg-red-50 rounded"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported && (
        <button
          onClick={handleRegister}
          disabled={registering}
          className="w-full text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl disabled:opacity-50"
        >
          {registering ? 'Registrando...' : '+ Registrar este dispositivo'}
        </button>
      )}

      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </section>
  )
}
