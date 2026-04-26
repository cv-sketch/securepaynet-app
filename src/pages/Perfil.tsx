import { Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { maskCBU } from '../lib/format'

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

      <button
        onClick={signOut}
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
