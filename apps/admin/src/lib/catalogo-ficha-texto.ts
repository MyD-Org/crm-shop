/**
 * Texto de un PDF por página (capa de texto), con `unpdf`. Sin red ni base: lo usan los scripts
 * locales que verifican lo que leyó un modelo contra lo que el PDF dice de verdad.
 *
 * Orden FÍSICO (índice i = página i+1). Un PDF escaneado (sin capa de texto) da páginas vacías:
 * `tieneTexto` lo detecta y quien lo usa NO debe cargar nada a partir de ese PDF.
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

/** Mínimo de caracteres útiles (alfanuméricos) por página, en promedio, para decir que hay texto. */
export const MIN_CARACTERES_POR_PAGINA = 40

export function tieneTexto(paginas: readonly string[]): boolean {
  if (paginas.length === 0) return false
  const utiles = paginas.reduce((n, p) => n + (p.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0)
  return utiles / paginas.length >= MIN_CARACTERES_POR_PAGINA
}
