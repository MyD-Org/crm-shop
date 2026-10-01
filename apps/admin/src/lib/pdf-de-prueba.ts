import { PDFDocument, StandardFonts } from "pdf-lib"

/** Un texto en una posición de la página (origen abajo a la izquierda, como pdfjs). */
export interface TextoPosicionado {
  t: string
  x: number
  y: number
}

/** PDF de prueba (sólo para tests): una página por entrada, una línea de texto por elemento (vacío = página sin texto). */
export async function crearPdfDePrueba(paginas: string[][]): Promise<Uint8Array> {
  return crearPdfPosicionado(paginas.map((lineas) => lineas.map((t, i) => ({ t, x: 40, y: 780 - i * 18 }))))
}

/** PDF de prueba con cada texto en su posición: sirve para armar tablas (por fila o transpuestas). */
export async function crearPdfPosicionado(paginas: TextoPosicionado[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  for (const textos of paginas) {
    const p = pdf.addPage([595, 842])
    for (const { t, x, y } of textos) if (t) p.drawText(t, { x, y, size: 9, font: fuente })
  }
  return pdf.save()
}
