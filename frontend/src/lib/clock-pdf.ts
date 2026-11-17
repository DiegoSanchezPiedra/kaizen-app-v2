import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { authorName, type ClockMonth, correctionAt, dayLabel, draftOf, formatDuration, hasCorrected, listOf, pausesText, sheetFooter, STATUS_LABEL, when, whatOf } from '@/lib/clock'
import { formatMonth } from '@/lib/dates'
import { formatShortDate } from '@/lib/format'

// La hoja de /clock/print en PDF A4, con los mismos textos y en blanco y negro. Solo para la app instalada de iOS,
// donde window.print() no hace nada. Márgenes como el @page de la hoja: 15 mm; el pie va en los 18 mm de abajo.
const LEFT = 15
const RIGHT = 195
const WIDTH = RIGHT - LEFT
const TOP = 18
const BOTTOM = 277
const INK = 0
const GREY = 70

type Font = { size?: number; bold?: boolean; grey?: boolean }

export function clockPdf(data: ClockMonth, month: string, now: number): File {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' })
  let y = TOP
  const font = ({ size = 10, bold = false, grey = false }: Font = {}) => doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(grey ? GREY : INK)
  const lineH = (size: number) => size * 0.45
  const lines = (s: string, f: Font = {}) => (font(f), doc.splitTextToSize(s, WIDTH) as string[])
  // Lo que no cabe entero en lo que queda de página empieza en la siguiente.
  const room = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage()
      y = TOP
    }
  }
  const text = (s: string, f: Font = {}, gap = 1.5) => {
    const ls = lines(s, f)
    doc.text(ls, LEFT, y, { baseline: 'top' })
    y += ls.length * lineH(f.size ?? 10) + gap
  }

  // Cabecera: academia, título, trabajador y mes; el total a la derecha.
  text('KAIZEN · CIF: ____________', { size: 8, bold: true, grey: true }, 2)
  text('Registro de jornada', { size: 16, bold: true }, 2)
  text(`Trabajador: ${data.profile.display_name ?? 'Sin nombre'}`)
  text(`Mes: ${formatMonth(month)}`)
  font({ size: 8, grey: true })
  doc.text('Total del mes', RIGHT, TOP + 9, { align: 'right', baseline: 'top' })
  font({ size: 18, bold: true })
  doc.text(`${formatDuration(data.total_seconds)} h`, RIGHT, TOP + 13, { align: 'right', baseline: 'top' })
  y += 1
  doc.setDrawColor(INK).setLineWidth(0.3).line(LEFT, y, RIGHT, y)
  y += 5

  const draft = draftOf(data)
  if (draft) {
    const ls = lines(`Borrador: mes sin cerrar a ${when(new Date(now).toISOString())} (${draft}).`, { bold: true })
    const h = ls.length * lineH(10) + 5
    doc.setLineDashPattern([1.2, 1], 0).setLineWidth(0.4).rect(LEFT, y, WIDTH, h).setLineDashPattern([], 0)
    doc.text(ls, LEFT + 3, y + 2.5, { baseline: 'top', maxWidth: WIDTH - 6 })
    y += h + 4
  }
  const employee = data.profile.employment === 'employee'
  if (!employee) text('Profesor autónomo: registro informativo, sin firma.', { grey: true }, 3)

  if (data.days.length === 0) text('Sin fichajes este mes.', { grey: true }, 4)
  else {
    autoTable(doc, {
      startY: y,
      margin: { left: LEFT, right: 210 - RIGHT, top: TOP, bottom: 297 - BOTTOM },
      theme: 'plain',
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.2, bottom: 1.2, left: 0, right: 3 }, textColor: INK, lineColor: 140, lineWidth: { bottom: 0.1 } },
      headStyles: { fontStyle: 'bold', fontSize: 8, textColor: GREY, lineColor: INK, lineWidth: { bottom: 0.3 } },
      columnStyles: { 4: { halign: 'right', fontStyle: 'bold', cellPadding: { top: 1.2, bottom: 1.2, left: 0, right: 0 } } },
      head: [['Día', 'Entrada', 'Pausas', 'Salida', { content: 'Horas', styles: { halign: 'right' } }]],
      body: data.days.map((d) => [`${dayLabel(d.date)}${d.open ? '\nJornada abierta' : ''}`, listOf(d.events, 'in'), pausesText(d.events), listOf(d.events, 'out'), formatDuration(d.worked_seconds)]),
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2
  }
  if (hasCorrected(data)) text('* Hora corregida: ver «Correcciones».', { size: 8, grey: true }, 3)

  if (data.corrections.length > 0) {
    room(12)
    y += 2
    text('Correcciones', { size: 11, bold: true }, 2)
    for (const c of data.corrections) {
      const at = correctionAt(c, data)
      const resolved = c.resolved_at ? ` · ${STATUS_LABEL[c.status]} por ${authorName(c.resolved_by)} el ${when(c.resolved_at)}` : ''
      const parts: [string, Font][] = [
        [`${STATUS_LABEL[c.status].toUpperCase()} · ${at ? `${formatShortDate(at)} · ` : ''}${whatOf(c, data)}`, { size: 9, bold: true }],
        [`Motivo: ${c.reason}`, { size: 9 }],
        [`Pedida por ${authorName(c.requested_by)} el ${when(c.created_at)}${resolved}`, { size: 9, grey: true }],
        ...(c.resolution_reason ? [[`Motivo del rechazo: ${c.resolution_reason}`, { size: 9 }] as [string, Font]] : []),
      ]
      // Cada corrección, entera en una página.
      room(parts.reduce((h, [s, f]) => h + lines(s, f).length * lineH(9) + 1, 3))
      for (const [s, f] of parts) text(s, f, 1)
      y += 1
      doc.setDrawColor(140).setLineWidth(0.1).line(LEFT, y, RIGHT, y)
      y += 2.5
    }
  }

  // Total y firmas, juntos y sin partir.
  room(employee ? 46 : 12)
  y += 2
  doc.setDrawColor(INK).setLineWidth(0.3).line(LEFT, y, RIGHT, y)
  font({ bold: true })
  doc.text('Total del mes', LEFT, y + 2, { baseline: 'top' })
  doc.text(`${formatDuration(data.total_seconds)} h`, RIGHT, y + 2, { align: 'right', baseline: 'top' })
  y += 8
  doc.line(LEFT, y, RIGHT, y)
  if (employee) {
    y += 20
    for (const [i, label] of ['Firma del trabajador', 'Firma de la empresa'].entries()) {
      const x = LEFT + i * 95
      doc.setDrawColor(INK).setLineWidth(0.3).line(x, y, x + 85, y)
      font({ bold: true })
      doc.text(label, x, y + 2, { baseline: 'top' })
      font({ grey: true })
      doc.text('Fecha: ___/___/______', x, y + 7, { baseline: 'top' })
    }
  }

  // Pie en cada página: de quién es y «Página N de M».
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    font({ size: 8 })
    doc.text(sheetFooter(data, month), LEFT, 287)
    doc.text(`Página ${i} de ${pages}`, RIGHT, 287, { align: 'right' })
  }

  return new File([doc.output('blob')], `registro-jornada-${month}.pdf`, { type: 'application/pdf' })
}
