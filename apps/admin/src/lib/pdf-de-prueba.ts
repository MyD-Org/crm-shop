import { PDFDocument, StandardFonts } from "pdf-lib"

/** PDF de prueba (sólo para tests): una página por entrada, una línea de texto por elemento (vacío = página sin texto). */
export async function crearPdfDePrueba(paginas: string[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  for (const lineas of paginas) {
    const p = pdf.addPage([595, 842])
    lineas.forEach((l, i) => p.drawText(l, { x: 40, y: 780 - i * 18, size: 11, font: fuente }))
  }
  return pdf.save()
}
