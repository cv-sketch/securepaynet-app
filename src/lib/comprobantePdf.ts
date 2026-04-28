import { formatARS, formatDateAR } from './format'

export type ComprobanteData = {
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

const BRAND = '#1d4ed8'
const SLATE = '#334155'
const SLATE_LIGHT = '#94a3b8'

export async function generateComprobantePdf(c: ComprobanteData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  // Header
  doc.setFillColor(BRAND)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor('#ffffff')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('SecurePayNet', 15, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Comprobante de operación', 15, 24)

  // Monto
  doc.setTextColor(SLATE)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Operación exitosa', W / 2, 44, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.text(formatARS(c.monto), W / 2, 56, { align: 'center' })

  // Línea
  doc.setDrawColor(SLATE_LIGHT)
  doc.setLineDashPattern([2, 2], 0)
  doc.line(15, 65, W - 15, 65)
  doc.setLineDashPattern([], 0)

  // Detalle
  let y = 78
  const rows: Array<[string, string | null | undefined]> = [
    ['Tipo', c.tipo],
    ['Fecha', formatDateAR(c.fecha)],
    ['Número', c.numero],
    ['Destinatario', c.contraparte],
    ['CBU/CVU destino', c.cbu_contraparte],
    ['ID Coelsa', c.referencia],
    ['Estado', c.estado],
    ['Banco', 'Banco de Comercio'],
  ]

  doc.setFontSize(10)
  for (const [label, value] of rows) {
    if (!value) continue
    doc.setTextColor(SLATE_LIGHT)
    doc.setFont('helvetica', 'normal')
    doc.text(label, 15, y)
    doc.setTextColor(SLATE)
    doc.setFont('helvetica', 'bold')
    const text = String(value)
    const lines = doc.splitTextToSize(text, W - 70)
    doc.text(lines, W - 15, y, { align: 'right' })
    y += Array.isArray(lines) && lines.length > 1 ? 6 * lines.length : 8
  }

  // Footer
  doc.setDrawColor(SLATE_LIGHT)
  doc.line(15, y + 4, W - 15, y + 4)
  doc.setFontSize(8)
  doc.setTextColor(SLATE_LIGHT)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'Este comprobante es un respaldo digital de la operación. Conservalo para tus registros.',
    W / 2,
    y + 12,
    { align: 'center', maxWidth: W - 30 }
  )
  doc.text(
    'SecurePayNet S.A. — PSPCP registrado en BCRA',
    W / 2,
    y + 18,
    { align: 'center' }
  )

  return doc.output('blob')
}

// Genera la imagen del comprobante directamente con Canvas 2D, sin
// html2canvas. Tamano controlado (~600x~700 logical, 2x scale para
// nitidez en retina). Misma data que el PDF.
export async function generateComprobanteImage(c: ComprobanteData): Promise<Blob> {
  const SCALE = 2
  const W = 600

  const rows: Array<[string, string]> = []
  rows.push(['Tipo', c.tipo])
  rows.push(['Fecha', formatDateAR(c.fecha)])
  if (c.numero) rows.push(['Numero', String(c.numero)])
  if (c.contraparte) rows.push(['Destinatario', String(c.contraparte)])
  if (c.cbu_contraparte) rows.push(['CBU/CVU destino', String(c.cbu_contraparte)])
  if (c.referencia) rows.push(['ID Coelsa', String(c.referencia)])
  if (c.estado) rows.push(['Estado', String(c.estado)])
  rows.push(['Banco', 'Banco de Comercio'])

  const HEADER_H = 90
  const MONTO_H = 100
  const DIVIDER_H = 30
  const ROW_H = 38
  const FOOTER_H = 70
  const H = HEADER_H + MONTO_H + DIVIDER_H + (rows.length * ROW_H) + FOOTER_H

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d no soportado')
  ctx.scale(SCALE, SCALE)

  // Fondo
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Header brand
  ctx.fillStyle = BRAND
  ctx.fillRect(0, 0, W, HEADER_H)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 26px Arial, Helvetica, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('SecurePayNet', 24, 42)
  ctx.font = '14px Arial, Helvetica, sans-serif'
  ctx.fillText('Comprobante de operacion', 24, 66)

  // Monto block
  let y = HEADER_H + 28
  ctx.fillStyle = '#475569'
  ctx.font = '13px Arial, Helvetica, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Operacion exitosa', W / 2, y)
  y += 38
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 32px Arial, Helvetica, sans-serif'
  ctx.fillText(formatARS(c.monto), W / 2, y)
  y = HEADER_H + MONTO_H

  // Divider punteado
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(24, y)
  ctx.lineTo(W - 24, y)
  ctx.stroke()
  ctx.setLineDash([])
  y += DIVIDER_H

  // Rows key/value
  for (const [label, valueRaw] of rows) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '13px Arial, Helvetica, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(label, 24, y + 16)

    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 13px Arial, Helvetica, sans-serif'
    ctx.textAlign = 'right'
    const value = fitText(ctx, String(valueRaw), W - 200)
    ctx.fillText(value, W - 24, y + 16)

    y += ROW_H
  }

  // Footer
  y += 8
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(24, y)
  ctx.lineTo(W - 24, y)
  ctx.stroke()
  y += 22
  ctx.fillStyle = '#94a3b8'
  ctx.font = '11px Arial, Helvetica, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Comprobante digital. Conservalo para tus registros.', W / 2, y)
  y += 16
  ctx.fillText('SecurePayNet S.A. — PSPCP registrado en BCRA', W / 2, y)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob fallo'))),
      'image/png',
      0.95,
    )
  })
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  // Recortar al medio con elipsis si es muy largo (CVU/CBU largos)
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const candidate = text.slice(0, mid) + '…'
    if (ctx.measureText(candidate).width <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

export function comprobanteFilename(c: ComprobanteData, ext: 'pdf' | 'png'): string {
  const id = c.numero || c.id.slice(0, 8)
  return `comprobante-${id}.${ext}`
}
