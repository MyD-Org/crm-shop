// Armado de los dos payloads que el Shop lee del CRM. PURO: recibe filas y devuelve el objeto
// del contrato. Sin DB — la lectura vive en src/lib/catalogo-overlay-repo.ts y las rutas en
// src/app/api/internal/shop/{taxonomia,catalogo-overlay}/route.ts.
//
// Contrato: platform/contracts/catalogo-overlay/v1 (copia de los schemas y fixtures en
// test/contracts/catalogo-overlay/v1; actualizar las dos juntas).
//
// Dos formas distintas a propósito: la taxonomía son decenas de filas y viaja ENTERA con
// reemplazo atómico; el overlay son miles y viaja POR DELTA con cursor.

import type { FotoOverlay } from "@/db/schema"

export const VERSION_CONTRATO = "v1" as const

// ─── Taxonomía (reemplazo atómico) ───────────────────────────────────────────────────────

export interface CategoriaContratoV1 {
  id: string
  parentId: string | null
  nombre: string
  slug: string
  orden: number
  nivel: number
  activa: boolean
}

export interface TagContratoV1 {
  id: string
  nombre: string
  slug: string
}

export interface ContratoTaxonomiaV1 {
  version: typeof VERSION_CONTRATO
  tenant: string
  actualizadoEn: string
  categorias: CategoriaContratoV1[]
  tags: TagContratoV1[]
}

export interface CategoriaFila extends CategoriaContratoV1 {
  updatedAt: Date
}

export interface TagFila extends TagContratoV1 {
  updatedAt: Date
}

/**
 * Viaja el árbol ENTERO, incluidas las inactivas: el Shop necesita saber que existen para no
 * dejar productos huérfanos, y decide él si las navega.
 *
 * El diccionario de tags viaja acá y no en el delta del overlay. Ése es el motivo entero de que
 * los tags tengan entidad propia: renombrar uno usado por 800 productos no empuja NI UNA fila
 * al delta, porque el producto referencia el uuid y el nombre nuevo llega por este reemplazo.
 *
 * Orden determinista (los fixtures se comparan byte a byte): categorías por nivel, parentId
 * —las raíces primero—, orden y nombre; tags por nombre.
 */
export function armarContratoTaxonomiaV1(input: {
  tenant: string
  categorias: CategoriaFila[]
  tags: TagFila[]
  ahora: Date
}): ContratoTaxonomiaV1 {
  const categorias = [...input.categorias].sort(
    (a, b) =>
      a.nivel - b.nivel ||
      (a.parentId ?? "").localeCompare(b.parentId ?? "") ||
      a.orden - b.orden ||
      a.nombre.localeCompare(b.nombre),
  )
  const tags = [...input.tags].sort((a, b) => a.nombre.localeCompare(b.nombre))

  const tiempos = [...input.categorias, ...input.tags].map((f) => f.updatedAt.getTime())
  const actualizadoEn = tiempos.length ? new Date(Math.max(...tiempos)) : input.ahora

  return {
    version: VERSION_CONTRATO,
    tenant: input.tenant,
    actualizadoEn: actualizadoEn.toISOString(),
    categorias: categorias.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      nombre: c.nombre,
      slug: c.slug,
      orden: c.orden,
      nivel: c.nivel,
      activa: c.activa,
    })),
    tags: tags.map((t) => ({ id: t.id, nombre: t.nombre, slug: t.slug })),
  }
}

// ─── Overlay (delta con cursor keyset) ───────────────────────────────────────────────────

export interface ItemOverlayV1 {
  alegraId: string
  visible: boolean
  nombre: string | null
  descripcion: string | null
  categoriaId: string | null
  orden: number | null
  tagIds: string[]
  fotos: FotoOverlay[]
  updatedAt: string
}

export interface CursorOverlayV1 {
  desde: string
  cursor: string
}

export interface ContratoOverlayV1 {
  version: typeof VERSION_CONTRATO
  tenant: string
  items: ItemOverlayV1[]
  nextCursor: CursorOverlayV1 | null
  hasMore: boolean
}

export interface OverlayFila {
  alegraId: string
  visible: boolean
  nombre: string | null
  descripcion: string | null
  categoriaId: string | null
  orden: number | null
  tagIds: string[]
  fotos: FotoOverlay[]
  /**
   * ISO-8601 UTC ya serializado, con precisión de MICROSEGUNDOS — no un `Date`.
   *
   * No es un detalle de estilo: `timestamptz` de Postgres guarda microsegundos y
   * `Date.toISOString()` sólo llega al milisegundo. Con la versión truncada, el cursor que el
   * Shop devuelve queda por DEBAJO del `updated_at` real de la última fila que aplicó, esa fila
   * vuelve a entrar en la página siguiente, el cursor que calcula vuelve a ser el mismo, y el
   * delta no avanza NUNCA. Con 600 filas empatadas el bucle devuelve miles de filas repetidas.
   * Se detectó con el test de las 600 filas del mismo `updated_at`.
   */
  updatedAt: string
}

export const LIMIT_DEFAULT = 500
export const LIMIT_MIN = 1
export const LIMIT_MAX = 1000

const noVacio = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim()
  return s.length > 0 ? s : null
}

/**
 * Las filas llegan YA ordenadas por (updatedAt, alegraId) ascendente desde SQL: ese orden es la
 * garantía sobre la que se apoya el cursor y no se rearma acá.
 *
 * `hasMore` es "la query trajo exactamente `limit` filas". Un falso positivo (la página que
 * sigue viene vacía) es aceptable y barato.
 *
 * `nextCursor` es el (updatedAt, alegraId) del ÚLTIMO ítem de ESTA página, no del siguiente, y
 * es null cuando no hay más páginas. Ojo: null significa "dejá de paginar", NO "no avances el
 * cursor" — el consumidor avanza su marca aplicada con el último ítem que aplicó, que viene en
 * `items`. Si tratara el null como "no avanzo", volvería a pedir el mismo lote para siempre.
 */
export function armarContratoOverlayV1(input: {
  tenant: string
  filas: OverlayFila[]
  limit: number
}): ContratoOverlayV1 {
  const items: ItemOverlayV1[] = input.filas.map((f) => ({
    alegraId: f.alegraId,
    visible: f.visible,
    nombre: noVacio(f.nombre),
    descripcion: noVacio(f.descripcion),
    categoriaId: f.categoriaId,
    orden: f.orden,
    tagIds: f.tagIds,
    fotos: f.fotos,
    updatedAt: f.updatedAt,
  }))

  const hasMore = input.filas.length === input.limit
  const ultimo = items.at(-1)

  return {
    version: VERSION_CONTRATO,
    tenant: input.tenant,
    items,
    nextCursor: hasMore && ultimo ? { desde: ultimo.updatedAt, cursor: ultimo.alegraId } : null,
    hasMore,
  }
}

// ─── Validación de los parámetros de la query ────────────────────────────────────────────

export type ErrorParam = "invalid desde" | "invalid limit"

export interface ParamsDelta {
  /**
   * El texto ISO TAL CUAL vino, no un `Date`: pasarlo por `Date` truncaría los microsegundos y
   * el cursor volvería a quedar por debajo de la fila que lo generó (ver `OverlayFila.updatedAt`).
   */
  desde: string | null
  cursor: string
  limit: number
}

/** ISO-8601 con hasta 6 decimales y desfasaje opcional. Acota lo que se le pasa a Postgres. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/

/**
 * `cursor` sólo se interpreta si vino `desde`: solo no dice nada (el cursor es el desempate de
 * un timestamp, no un identificador de página).
 */
export function parsearParamsDelta(params: URLSearchParams): Resultado<ParamsDelta> {
  const crudoLimit = params.get("limit")?.trim()
  let limit = LIMIT_DEFAULT
  if (crudoLimit) {
    limit = Number(crudoLimit)
    if (!Number.isInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
      return { ok: false, error: "invalid limit" }
    }
  }

  const crudoDesde = params.get("desde")?.trim() || null
  if (crudoDesde !== null) {
    if (!ISO_RE.test(crudoDesde) || Number.isNaN(new Date(crudoDesde).getTime())) {
      return { ok: false, error: "invalid desde" }
    }
  }

  return {
    ok: true,
    value: { desde: crudoDesde, cursor: crudoDesde ? (params.get("cursor")?.trim() ?? "") : "", limit },
  }
}

type Resultado<T> = { ok: true; value: T } | { ok: false; error: ErrorParam }
