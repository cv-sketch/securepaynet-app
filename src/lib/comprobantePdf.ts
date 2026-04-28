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

export function comprobanteFilename(c: ComprobanteData, ext: 'pdf' | 'png'): string {
  const id = c.numero || c.id.slice(0, 8)
  return `comprobante-${id}.${ext}`
}
