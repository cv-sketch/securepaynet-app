import type { MovimientoLite } from './movimientoComprobante'

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildMovimientosCsv(rows: MovimientoLite[]): Blob {
  const header = ['fecha', 'tipo', 'descripcion', 'monto', 'estado', 'referencia']
  const lines: string[] = [header.join(',')]
  for (const m of rows) {
    const monto = Number(m.monto)
    const signed = m.tipo === 'credito' ? monto : -monto
    lines.push([
      csvEscape(new Date(m.created_at).toISOString()),
      csvEscape(m.tipo === 'credito' ? 'Ingreso' : 'Egreso'),
      csvEscape(m.descripcion ?? ''),
      csvEscape(signed.toFixed(2)),
      csvEscape(m.estado ?? ''),
      csvEscape(m.referencia ?? ''),
    ].join(','))
  }
  return new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

export function statementCsvFilename(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `statement-${y}${m}${d}.csv`
}
