import { formatARS, formatDateAR } from './format'
import type { MovimientoLite } from './movimientoComprobante'

export type StatementClienteInfo = {
  nombre?: string | null
  apellido?: string | null
  cuit?: string | null
  email?: string | null
}

export type StatementWalletInfo = {
  cvu?: string | null
  alias?: string | null
  saldo?: number | string | null
}

export type StatementInput = {
  cliente: StatementClienteInfo
  wallet: StatementWalletInfo
  rows: MovimientoLite[]
}

const BRAND = '#1d4ed8'
const SLATE = '#0f172a'
const SLATE_MID = '#334155'
const SLATE_LIGHT = '#94a3b8'
const ROW_LINE = '#e2e8f0'

export async function generateStatementPdf({
  cliente,
  wallet,
  rows,
}: StatementInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  const totalCred = rows
    .filter((r) => r.tipo === 'credito')
    .reduce((a, r) => a + Number(r.monto), 0)
  const totalDeb = rows
    .filter((r) => r.tipo !== 'credito')
    .reduce((a, r) => a + Number(r.monto), 0)
  const fechas = rows.map((r) => new Date(r.created_at).getTime())
  const desde = fechas.length ? new Date(Math.min(...fechas)) : null
  const hasta = fechas.length ? new Date(Math.max(...fechas)) : null

  const titular = `${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim() || '-'
  const generated = formatDateAR(new Date().toISOString())

  let pageNum = 1

  function header() {
    doc.setFillColor(BRAND)
    doc.rect(0, 0, W, 28, 'F')
    doc.setTextColor('#ffffff')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text('SecurePayNet', 15, 18)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('Statement de cuenta', 15, 24)
    doc.setFontSize(9)
    doc.text(`Generado: ${generated}`, W - 15, 18, { align: 'right' })
    doc.text(`Pagina ${pageNum}`, W - 15, 24, { align: 'right' })
  }

  function accountBlock() {
    doc.setTextColor(SLATE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(titular, 15, 40)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(SLATE_MID)
    const lines: string[] = []
    if (cliente.cuit) lines.push(`CUIT: ${cliente.cuit}`)
    if (cliente.email) lines.push(cliente.email)
    if (wallet.cvu) lines.push(`CVU: ${wallet.cvu}`)
    if (wallet.alias) lines.push(`Alias: ${wallet.alias}`)
    let yL = 46
    for (const l of lines) { doc.text(l, 15, yL); yL += 5 }

    doc.setFontSize(9)
    doc.setTextColor(SLATE_LIGHT)
    doc.text('Periodo', W - 15, 40, { align: 'right' })
    doc.setTextColor(SLATE)
    doc.setFont('helvetica', 'bold')
    const periodo = desde && hasta
      ? `${formatDateAR(desde.toISOString())} — ${formatDateAR(hasta.toISOString())}`
      : '-'
    doc.text(periodo, W - 15, 45, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(SLATE_LIGHT)
    doc.text('Ingresos / Egresos', W - 15, 52, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setTextColor('#059669')
    doc.text(`+ ${formatARS(totalCred)}`, W - 15, 57, { align: 'right' })
    doc.setTextColor('#b91c1c')
    doc.text(`- ${formatARS(totalDeb)}`, W - 15, 62, { align: 'right' })
  }

  const COL_FECHA = 15
  const COL_DESC = 50
  const COL_TIPO = 130
  const COL_MONTO_RIGHT = W - 15
  const ROW_HEIGHT = 7
  const TABLE_TOP = 78

  function tableHeader(y: number) {
    doc.setFillColor('#f1f5f9')
    doc.rect(10, y - 5, W - 20, 8, 'F')
    doc.setTextColor(SLATE_LIGHT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('FECHA', COL_FECHA, y)
    doc.text('DESCRIPCION', COL_DESC, y)
    doc.text('TIPO', COL_TIPO, y)
    doc.text('MONTO', COL_MONTO_RIGHT, y, { align: 'right' })
  }

  function pageFooter() {
    doc.setDrawColor(ROW_LINE)
    doc.line(15, H - 18, W - 15, H - 18)
    doc.setFontSize(8)
    doc.setTextColor(SLATE_LIGHT)
    doc.setFont('helvetica', 'normal')
    doc.text('SecurePayNet S.A. — PSPCP registrado en BCRA', W / 2, H - 12, { align: 'center' })
  }

  header()
  accountBlock()
  let y = TABLE_TOP
  tableHeader(y)
  y += 7

  doc.setFontSize(9)

  for (const r of rows) {
    if (y > H - 25) {
      pageFooter()
      doc.addPage()
      pageNum += 1
      header()
      accountBlock()
      y = TABLE_TOP
      tableHeader(y)
      y += 7
      doc.setFontSize(9)
    }

    const monto = Number(r.monto)
    const isCredito = r.tipo === 'credito'

    doc.setTextColor(SLATE_MID)
    doc.setFont('helvetica', 'normal')
    doc.text(formatDateAR(r.created_at), COL_FECHA, y)

    doc.setTextColor(SLATE)
    const desc = r.descripcion || (isCredito ? 'Credito' : 'Debito')
    const descLines = doc.splitTextToSize(desc, COL_TIPO - COL_DESC - 4)
    doc.text(Array.isArray(descLines) ? descLines[0] : desc, COL_DESC, y)

    doc.setTextColor(SLATE_MID)
    doc.text(isCredito ? 'Ingreso' : 'Egreso', COL_TIPO, y)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(isCredito ? '#059669' : '#0f172a')
    doc.text(
      `${isCredito ? '+ ' : '- '}${formatARS(Math.abs(monto))}`,
      COL_MONTO_RIGHT,
      y,
      { align: 'right' },
    )

    doc.setDrawColor(ROW_LINE)
    doc.setLineWidth(0.1)
    doc.line(15, y + 2, W - 15, y + 2)

    y += ROW_HEIGHT
  }

  pageFooter()

  return doc.output('blob')
}

export function statementPdfFilename(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `statement-${y}${m}${d}.pdf`
}
