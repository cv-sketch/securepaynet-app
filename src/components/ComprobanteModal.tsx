import { formatARS, formatDateAR } from '../lib/format'

type Comprobante = {
  id: string
  numero?: string | null
  fecha: string
  tipo: string
  monto: number | string
  contraparte?: string | null
  cbu_contraparte?: string | null
  referencia?: string | null
  estado?: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  comprobante: Comprobante | null
}

export default function ComprobanteModal({ open, onClose, comprobante }: Props) {
  if (!open || !comprobante) return null

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

        <button
          onClick={onClose}
          className="mt-6 w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-xl"
        >
          Cerrar
        </button>

        <p className="text-[10px] text-slate-400 text-center mt-3">
          Este comprobante es un respaldo digital de la operación. Conservalo
          para tus registros.
        </p>
      </div>
    </div>
  )
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