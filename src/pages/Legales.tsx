import { Link } from 'react-router-dom'

export default function Legales() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Legales y normativa</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900">
        <strong>Importante:</strong> SecurePayNet S.A. es un Proveedor de Servicios de Pago que ofrece Cuentas de Pago (PSPCP) registrado en el Banco Central de la Republica Argentina (BCRA). Los fondos depositados en cuentas de pago no constituyen depositos en una entidad financiera, ni cuentan con ninguna de las garantias que tales depositos puedan gozar.
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        <Item to="/legales/terminos" label="Terminos y Condiciones" />
        <Item to="/legales/privacidad" label="Politica de Privacidad" />
        <Item to="/legales/arrepentimiento" label="Boton de Arrepentimiento (Res. 424/2020)" />
        <Item to="/legales/baja" label="Solicitud de Baja (Res. 316/2018)" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 text-xs text-slate-600 space-y-2">
        <div className="font-semibold text-slate-900">Cumplimiento normativo</div>
        <ul className="list-disc pl-4 space-y-1">
          <li>Ley 25.326 de Proteccion de Datos Personales</li>
          <li>Ley 24.240 de Defensa del Consumidor</li>
          <li>Resolucion BCRA "A" 7825 y modificatorias (PSPCP)</li>
          <li>Resolucion 424/2020 SCI - Boton de Arrepentimiento</li>
          <li>Resolucion 316/2018 SCI - Baja de servicios</li>
          <li>Ley 25.246 - Encubrimiento y lavado de activos (UIF)</li>
        </ul>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        SecurePayNet S.A. - CUIT XX-XXXXXXXX-X - Domicilio legal: [direccion] - CABA, Argentina
      </p>
    </div>
  )
}

function Item({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex items-center justify-between p-4 hover:bg-slate-50 text-sm">
      <span>{label}</span>
      <span className="text-slate-300">{'>'}</span>
    </Link>
  )
}
