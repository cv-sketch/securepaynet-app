export default function Soporte() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Soporte</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-sm">
        <div>
          <div className="font-semibold">Centro de ayuda</div>
          <p className="text-xs text-slate-500 mt-1">
            Estamos disponibles para ayudarte con tus operaciones, dudas o reclamos.
          </p>
        </div>

        <Channel label="Email" value="soporte@securepaynet.com.ar" />
        <Channel label="WhatsApp" value="+54 11 0000-0000" />
        <Channel label="Telefono" value="0800-000-0000" />
        <Channel label="Horario" value="Lunes a Viernes 9 a 18 hs" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm space-y-2">
        <div className="font-semibold">Defensa al consumidor</div>
        <p className="text-xs text-slate-600">
          Si no obtuviste respuesta a tu reclamo, podes acudir a la Direccion Nacional de Defensa del Consumidor y Arbitraje de Consumo.
        </p>
        <a
          href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand-600 font-semibold inline-block"
        >
          Ir a Defensa del Consumidor &rarr;
        </a>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm space-y-2">
        <div className="font-semibold">Reportes UIF</div>
        <p className="text-xs text-slate-600">
          Para denuncias por sospechas de lavado de activos o financiamiento del terrorismo, contactate con la Unidad de Informacion Financiera.
        </p>
        <a
          href="https://www.argentina.gob.ar/uif"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand-600 font-semibold inline-block"
        >
          Ir a UIF &rarr;
        </a>
      </div>
    </div>
  )
}

function Channel({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  )
}
