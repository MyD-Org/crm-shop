/**
 * Texto de un PDF con `unpdf` (pdfjs). Sin red ni base: lo usan los scripts locales que verifican lo
 * que leyó un modelo contra lo que el PDF dice de verdad.
 *
 * - `extraerTextoPaginas`: texto plano por página, en orden físico (índice i = página i+1).
 * - `extraerItemsPaginas`: items de texto CON coordenadas (x, y, ancho, alto). Las tablas de los
 *   catálogos salen de pdfjs por celdas (a veces por columna), así que la evidencia de que un valor
 *   pertenece a una fila o a una columna se decide por posición, no por contigüidad del texto.
 *
 * Un PDF escaneado (sin capa de texto) da páginas vacías: `tieneTexto` lo detecta y quien lo usa NO
 * debe cargar nada a partir de ese PDF.
 */
import { extractText, getDocumentProxy } from "unpdf"

export class PdfIlegible extends Error {
  constructor(causa?: unknown) {
    super(`No se pudo leer el PDF${causa instanceof Error ? `: ${causa.message}` : ""}`)
    this.name = "PdfIlegible"
  }
}

export interface TextoPdf {
  total: number
  paginas: string[]
}

export async function extraerTextoPaginas(bytes: Uint8Array): Promise<TextoPdf> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    return { total: totalPages, paginas: text }
  } catch (err) {
    throw new PdfIlegible(err)
  }
}

/** Un fragmento de texto con su posición en la página (origen abajo a la izquierda, como pdfjs). */
export interface ItemTexto {
  str: string
  x: number
  y: number
  w: number
  h: number
}

/** Items de texto por página, en orden físico. */
export async function extraerItemsPaginas(bytes: Uint8Array): Promise<ItemTexto[][]> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const paginas: ItemTexto[][] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const contenido = await (await pdf.getPage(n)).getTextContent()
      const items: ItemTexto[] = []
      for (const it of contenido.items) {
        if (!("str" in it) || !it.str.trim()) continue
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height })
      }
      paginas.push(items)
    }
    return paginas
  } catch (err) {
    throw new PdfIlegible(err)
  }
}

/** Agrupa items en líneas (misma `y`, tolerancia ~ mitad de la altura de fuente), de arriba a abajo y por `x`. */
export function agruparLineas<T extends { x: number; y: number; h: number }>(items: readonly T[]): T[][] {
  const orden = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lineas: T[][] = []
  let y = 0
  let h = 0
  for (const it of orden) {
    const tol = Math.max(2.5, 0.5 * Math.max(h, it.h))
    if (lineas.length && Math.abs(y - it.y) <= tol) {
      lineas[lineas.length - 1].push(it)
    } else {
      lineas.push([it])
      y = it.y
      h = it.h
    }
  }
  for (const l of lineas) l.sort((a, b) => a.x - b.x)
  return lineas
}

/** Texto de una página reconstruido por líneas. */
export function textoDeItems(items: readonly ItemTexto[]): string {
  return agruparLineas(items)
    .map((l) => l.map((i) => i.str).join(" "))
    .join("\n")
}

/** Mínimo de caracteres útiles (alfanuméricos) por página, en promedio, para decir que hay texto. */
export const MIN_CARACTERES_POR_PAGINA = 40

export function tieneTexto(paginas: readonly string[]): boolean {
  if (paginas.length === 0) return false
  const utiles = paginas.reduce((n, p) => n + (p.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0)
  return utiles / paginas.length >= MIN_CARACTERES_POR_PAGINA
}
