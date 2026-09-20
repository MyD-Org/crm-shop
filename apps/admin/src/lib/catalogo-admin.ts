import {
  esUuid,
  registrarAvisoShop,
  LIMITE_LISTADO_DEFAULT,
  LIMITE_LISTADO_MAX,
  type FiltrosAdmin,
  type OrdenListado,
  type Seleccion,
} from "@/lib/catalogo-overlay-repo"
import { pingShopRevalidarCatalogo } from "@/lib/shop-revalidar"
import type { FotoOverlay } from "@/db/schema"
import { basePublicaFotos } from "./shop-media"

// Piezas compartidas por /api/admin/catalogo/*: respuestas, parseo de la query del listado y el
// aviso al Shop. Todos los textos van en español formal de usted — los `{error}` de acá se
// muestran tal cual en pantalla.

export const NO_STORE = { "Cache-Control": "private, no-store" }

export const invalidResponse = (error: string, campo?: string): Response =>
  Response.json({ error, code: "invalid", ...(campo ? { campo } : {}) }, { status: 400, headers: NO_STORE })

export const validacionResponse = (error: string, campo: string): Response =>
  Response.json({ error, code: "invalid", campo }, { status: 422, headers: NO_STORE })

export const duplicadoResponse = (error: string, campo: string): Response =>
  Response.json({ error, code: "duplicado", campo }, { status: 422, headers: NO_STORE })

export const conflictoResponse = (error: string, code: string): Response =>
  Response.json({ error, code }, { status: 409, headers: NO_STORE })

/**
 * Aviso al Shop DESPUÉS de persistir. Nunca tira y nunca bloquea el guardado: si no propaga, el
 * cambio ya quedó y la tienda lo toma en su próximo ciclo. De paso registra la frescura que el
 * panel muestra (decisión D1: el CRM informa su propio último aviso entregado, no le pregunta
 * al Shop cuándo sincronizó).
 */
export async function avisarShop(tenantId: string): Promise<{ propagado: boolean }> {
  const { propagado } = await pingShopRevalidarCatalogo()
  try {
    await registrarAvisoShop(tenantId, propagado)
  } catch (err) {
    // La frescura es informativa: que no se pueda registrar no puede tumbar un guardado que ya
    // se persistió.
    console.warn(`[catalogo] no se pudo registrar el aviso al Shop: ${err instanceof Error ? err.name : "error"}`)
  }
  return { propagado }
}

export interface QueryListado {
  filtros: FiltrosAdmin
  start: number
  limit: number
  orden: OrdenListado
}

/** Parseo y validación de la query del listado. Un valor fuera de dominio es 400, no un default. */
export function parsearQueryListado(url: URL): QueryListado | Response {
  const p = url.searchParams
  const filtros: FiltrosAdmin = {}

  const q = (p.get("q") ?? "").trim()
  if (q.length > 120) return invalidResponse("La búsqueda es demasiado larga", "q")
  if (q) filtros.q = q

  const categoria = p.get("categoria")
  if (categoria !== null) {
    if (categoria !== "sin" && !esUuid(categoria)) return invalidResponse("La categoría es inválida", "categoria")
    filtros.categoria = categoria
  }

  const estado = p.get("estado")
  if (estado !== null) {
    if (estado !== "visible" && estado !== "oculto") return invalidResponse("El estado es inválido", "estado")
    filtros.estado = estado
  }

  const foto = p.get("foto")
  if (foto !== null) {
    if (foto !== "con" && foto !== "sin") return invalidResponse("El filtro de fotos es inválido", "foto")
    filtros.foto = foto
  }

  const nombre = p.get("nombre")
  if (nombre !== null) {
    if (nombre !== "sin") return invalidResponse("El filtro de nombre es inválido", "nombre")
    filtros.nombre = nombre
  }

  const alegra = p.get("alegra")
  if (alegra !== null) {
    if (alegra !== "active" && alegra !== "inactive") return invalidResponse("El filtro de Alegra es inválido", "alegra")
    filtros.alegra = alegra
  }

  const precio = p.get("precio")
  if (precio !== null) {
    if (precio !== "con" && precio !== "sin") return invalidResponse("El filtro de precio es inválido", "precio")
    filtros.precio = precio
  }

  const tag = p.get("tag")
  if (tag !== null) {
    if (!esUuid(tag)) return invalidResponse("La etiqueta es inválida", "tag")
    filtros.tag = tag
  }

  const startParam = p.get("start")
  const start = startParam === null ? 0 : Number(startParam)
  if (!Number.isInteger(start) || start < 0) return invalidResponse("La paginación es inválida", "start")

  const limitParam = p.get("limit")
  const limit = limitParam === null ? LIMITE_LISTADO_DEFAULT : Number(limitParam)
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITE_LISTADO_MAX) {
    return invalidResponse("El límite es inválido", "limit")
  }

  const ordenParam = p.get("orden")
  if (ordenParam !== null && ordenParam !== "nombre" && ordenParam !== "nombre-desc" && ordenParam !== "actualizado") {
    return invalidResponse("El orden es inválido", "orden")
  }
  const orden: OrdenListado = (ordenParam as OrdenListado | null) ?? "nombre"

  return { filtros, start, limit, orden }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

const esListaDeStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)

/**
 * Descriptor de selección de las masivas. Dos formas: por identificadores (lo que está tildado
 * en la página) o por FILTRO ("todo lo que coincide"), que el servidor vuelve a evaluar — así el
 * navegador nunca manda ~5959 identificadores, y el número de afectados lo cuenta el servidor.
 */
export function parsearSeleccion(body: unknown): Seleccion | Response {
  if (!esObjeto(body) || !esObjeto(body.seleccion)) {
    return invalidResponse("Seleccione al menos un producto", "seleccion")
  }
  const s = body.seleccion
  if (s.tipo === "ids") {
    if (!esListaDeStrings(s.alegraIds)) return invalidResponse("La selección es inválida", "alegraIds")
    return { tipo: "ids", alegraIds: s.alegraIds }
  }
  if (s.tipo === "filtro") {
    // Los filtros del descriptor se validan con el MISMO parser que la query del listado: una
    // masiva "sobre todo lo que coincide" tiene que resolver exactamente el mismo conjunto.
    const params = new URLSearchParams()
    if (esObjeto(s.filtros)) {
      for (const clave of ["q", "categoria", "estado", "foto", "nombre", "alegra", "precio", "tag"]) {
        const valor = s.filtros[clave]
        if (typeof valor === "string" && valor !== "") params.set(clave, valor)
      }
    }
    const filtros = parsearQueryListado(new URL(`http://interno/?${params.toString()}`))
    if (filtros instanceof Response) return filtros
    const excluir = s.excluir === undefined ? [] : s.excluir
    if (!esListaDeStrings(excluir) && !(Array.isArray(excluir) && excluir.length === 0)) {
      return invalidResponse("La selección es inválida", "excluir")
    }
    return { tipo: "filtro", filtros: filtros.filtros, excluir: excluir as string[] }
  }
  return invalidResponse("La selección es inválida", "seleccion")
}

/**
 * Agrega a cada foto su `url` pública, componiéndola desde la key.
 *
 * La base vive sólo en el entorno (`R2_SHOP_MEDIA_PUBLIC_URL`) y nunca en la base de datos, así
 * que mover las fotos a otro dominio no toca ni una fila. Sin bucket configurado la foto viaja
 * con `url: null` y el panel muestra el recuadro vacío en vez de una imagen rota.
 */
export function conUrlDeFotos<T extends { fotos: FotoOverlay[] }>(
  p: T,
  base: string | null = basePublicaFotos(),
): Omit<T, "fotos"> & { fotos: (FotoOverlay & { url: string | null })[] } {
  return { ...p, fotos: p.fotos.map((f) => ({ ...f, url: base ? `${base}/${f.key}` : null })) }
}
