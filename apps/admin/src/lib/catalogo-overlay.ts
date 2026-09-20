// Catálogo comercial del Shop administrado desde el CRM. Lógica PURA: slugs, validación de la
// jerarquía de categorías y de los tags, resolución de nombre/SKU y la regla de "publicado".
// Sin DB: el acceso a datos vive en src/lib/catalogo-overlay-repo.ts.
//
// Dos cosas de acá son contrato compartido con el Shop (platform/contracts/catalogo-overlay/v1)
// y por eso están escritas una sola vez:
//   - la regla de nombre (REQ-NOM-01) y la de SKU (REQ-NOM-02),
//   - la regla de publicado (REQ-PUB-01), que el CRM evalúa de forma ORIENTATIVA y el Shop
//     vuelve a evaluar sobre su propia copia — su evaluación es la que manda.

import { sql, type SQL } from "drizzle-orm"

export type Resultado<T> = { ok: true; value: T } | { ok: false; campo: string; error: string }

const fail = (campo: string, error: string): { ok: false; campo: string; error: string } => ({ ok: false, campo, error })

export const NIVEL_MAX = 3
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NOMBRE_MAX = 100

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// ─── Slugs ───────────────────────────────────────────────────────────────────────────────

/**
 * "Iluminación LED / Exterior" → "iluminacion-led-exterior".
 * Saca acentos (NFD + corte de diacríticos), baja a minúsculas y colapsa todo lo que no sea
 * alfanumérico en un solo guion. Devuelve "" si no queda nada utilizable: quien llama decide
 * si eso es un error (lo es, en alta de categoría y de tag).
 */
export function slugify(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export const esSlugValido = (slug: string): boolean => SLUG_RE.test(slug)

/** El nivel resultante tiene que caber en la jerarquía (1..3). */
export const esNivelValido = (nivel: number): boolean =>
  Number.isInteger(nivel) && nivel >= 1 && nivel <= NIVEL_MAX

// ─── Categorías ──────────────────────────────────────────────────────────────────────────

export interface CategoriaValida {
  nombre: string
  slug: string
  parentId: string | null
  orden: number
  activa: boolean
  /** KEY del objeto en R2, nunca una url. Ver `urlPublicaFoto()`. */
  imagenKey: string | null
  imagenAlt: string | null
}

/** Lo mínimo que el validador de movimiento necesita saber de cada categoría del tenant. */
export interface NodoCategoria {
  id: string
  parentId: string | null
}

export function validarCategoria(body: unknown, actual?: CategoriaValida): Resultado<CategoriaValida> {
  if (!esObjeto(body)) return fail("body", "Datos inválidos")

  const crudoNombre = Object.prototype.hasOwnProperty.call(body, "nombre") ? body.nombre : actual?.nombre
  if (typeof crudoNombre !== "string") return fail("nombre", "Indique el nombre de la categoría")
  const nombre = crudoNombre.trim()
  if (!nombre) return fail("nombre", "Indique el nombre de la categoría")
  if (nombre.length > NOMBRE_MAX) return fail("nombre", `El nombre no puede superar los ${NOMBRE_MAX} caracteres`)

  // El slug se deriva del nombre salvo que lo manden explícito (permite conservarlo al
  // renombrar, para no romper los enlaces de la vidriera).
  const crudoSlug = Object.prototype.hasOwnProperty.call(body, "slug") ? body.slug : undefined
  const slug =
    typeof crudoSlug === "string" && crudoSlug.trim() ? slugify(crudoSlug) : slugify(nombre)
  if (!esSlugValido(slug)) return fail("slug", "El nombre tiene que incluir al menos una letra o un número")

  const crudoParent = Object.prototype.hasOwnProperty.call(body, "parentId")
    ? body.parentId
    : (actual?.parentId ?? null)
  if (crudoParent !== null && typeof crudoParent !== "string") return fail("parentId", "Categoría padre inválida")
  const parentId = crudoParent === null || crudoParent === "" ? null : crudoParent

  const crudoOrden = Object.prototype.hasOwnProperty.call(body, "orden") ? body.orden : (actual?.orden ?? 0)
  if (typeof crudoOrden !== "number" || !Number.isInteger(crudoOrden) || crudoOrden < 0 || crudoOrden > 9999) {
    return fail("orden", "El orden tiene que ser un número entero entre 0 y 9999")
  }

  const crudoActiva = Object.prototype.hasOwnProperty.call(body, "activa") ? body.activa : (actual?.activa ?? true)
  if (typeof crudoActiva !== "boolean") return fail("activa", "Estado inválido")

  // Imagen: se guarda la KEY del objeto en R2, nunca una url. `null` explícito la quita.
  const crudoImagen = Object.prototype.hasOwnProperty.call(body, "imagenKey")
    ? body.imagenKey
    : (actual?.imagenKey ?? null)
  if (crudoImagen !== null && typeof crudoImagen !== "string") return fail("imagenKey", "Imagen inválida")
  const imagenKey = crudoImagen === null || crudoImagen === "" ? null : crudoImagen
  if (imagenKey && (imagenKey.includes("..") || !imagenKey.startsWith("categorias/"))) {
    return fail("imagenKey", "Imagen inválida")
  }

  const crudoAlt = Object.prototype.hasOwnProperty.call(body, "imagenAlt") ? body.imagenAlt : (actual?.imagenAlt ?? null)
  if (crudoAlt !== null && typeof crudoAlt !== "string") return fail("imagenAlt", "Texto alternativo inválido")
  const imagenAlt = crudoAlt ? crudoAlt.trim().slice(0, 200) || null : null

  return {
    ok: true,
    value: { nombre, slug, parentId, orden: crudoOrden, activa: crudoActiva, imagenKey, imagenAlt },
  }
}

export type MotivoMovimiento = "ciclo" | "nivel" | "padre_inexistente"

/**
 * ¿Se puede colgar `id` de `nuevoParentId`? Se responde ANTES de escribir nada: el rechazo
 * tiene que dejar la jerarquía como estaba.
 *
 * Rechaza (a) que una categoría sea su propio ancestro y (b) que la rama movida termine
 * pasando de 3 niveles — mover A (que tiene A > B > C colgando) bajo una raíz Z daría
 * Z > A > B > C, aunque A "sola" cabría.
 *
 * `id` es null cuando se está validando un alta (todavía no hay rama que arrastrar).
 */
export function validarMovimiento(
  nodos: NodoCategoria[],
  id: string | null,
  nuevoParentId: string | null,
): Resultado<{ nivel: number }> {
  const porId = new Map(nodos.map((n) => [n.id, n]))

  let nivelPadre = 0
  if (nuevoParentId !== null) {
    if (!porId.has(nuevoParentId)) return fail("parentId", "La categoría padre no existe")
    // Profundidad del padre, subiendo por la cadena. El tope de iteraciones evita colgarse si
    // los datos ya vinieran con un ciclo.
    let cursor: string | null = nuevoParentId
    for (let i = 0; cursor !== null && i <= nodos.length; i++) {
      nivelPadre++
      if (cursor === id) return fail("parentId", "Una categoría no puede depender de sí misma")
      cursor = porId.get(cursor)?.parentId ?? null
    }
  }

  // Alto de la rama que se mueve (1 = la categoría sola, sin hijas).
  let altoRama = 1
  if (id !== null) {
    const hijasDe = new Map<string | null, NodoCategoria[]>()
    for (const n of nodos) {
      const lista = hijasDe.get(n.parentId)
      if (lista) lista.push(n)
      else hijasDe.set(n.parentId, [n])
    }
    const medir = (nodo: string, profundidad: number): number => {
      const hijas = hijasDe.get(nodo) ?? []
      if (hijas.length === 0 || profundidad >= NIVEL_MAX) return profundidad
      return Math.max(...hijas.map((h) => medir(h.id, profundidad + 1)))
    }
    altoRama = medir(id, 1)
  }

  const nivel = nivelPadre + 1
  if (nivelPadre + altoRama > NIVEL_MAX) {
    return fail("parentId", `La jerarquía admite hasta ${NIVEL_MAX} niveles`)
  }
  return { ok: true, value: { nivel } }
}

// ─── Edición por producto ────────────────────────────────────────────────────────────────

const DESCRIPCION_MAX = 2000

/** Sólo los campos que vinieron: lo que no está en el body queda como estaba en el overlay. */
export interface CamposOverlayValidos {
  visible?: boolean
  nombre?: string | null
  descripcion?: string | null
  categoriaId?: string | null
  orden?: number | null
  tagIds?: string[]
}

const presente = (body: Record<string, unknown>, clave: string): boolean =>
  Object.prototype.hasOwnProperty.call(body, clave)

/**
 * Campos editables de un producto. Nada de precio, stock ni alegra_id: no viven en el overlay y
 * no hay forma de mandarlos (REQ-OVL-02).
 *
 * Vaciar el nombre (cadena vacía o sólo espacios) NO es un error de validación: es la forma de
 * volver al nombre por defecto de Alegra, y se persiste como null (REQ-NOM-01).
 */
export function validarCamposOverlay(body: unknown): Resultado<CamposOverlayValidos> {
  if (!esObjeto(body)) return fail("body", "Datos inválidos")

  const campos: CamposOverlayValidos = {}

  if (presente(body, "visible")) {
    if (typeof body.visible !== "boolean") return fail("visible", "Estado de publicación inválido")
    campos.visible = body.visible
  }

  if (presente(body, "nombre")) {
    if (body.nombre !== null && typeof body.nombre !== "string") return fail("nombre", "Indique un nombre válido")
    const nombre = (body.nombre ?? "").trim()
    if (nombre.length > NOMBRE_MAX) return fail("nombre", `El nombre no puede superar los ${NOMBRE_MAX} caracteres`)
    campos.nombre = nombre === "" ? null : nombre
  }

  if (presente(body, "descripcion")) {
    if (body.descripcion !== null && typeof body.descripcion !== "string") {
      return fail("descripcion", "Indique una descripción válida")
    }
    const descripcion = (body.descripcion ?? "").trim()
    if (descripcion.length > DESCRIPCION_MAX) {
      return fail("descripcion", `La descripción no puede superar los ${DESCRIPCION_MAX} caracteres`)
    }
    campos.descripcion = descripcion === "" ? null : descripcion
  }

  if (presente(body, "categoriaId")) {
    if (body.categoriaId !== null && typeof body.categoriaId !== "string") {
      return fail("categoriaId", "Seleccione una categoría válida")
    }
    campos.categoriaId = body.categoriaId === null || body.categoriaId === "" ? null : body.categoriaId
  }

  if (presente(body, "orden")) {
    if (body.orden === null || body.orden === "") campos.orden = null
    else if (typeof body.orden !== "number" || !Number.isInteger(body.orden) || body.orden < 0 || body.orden > 9999) {
      return fail("orden", "El orden tiene que ser un número entero entre 0 y 9999")
    } else campos.orden = body.orden
  }

  if (presente(body, "tagIds")) {
    if (!Array.isArray(body.tagIds) || body.tagIds.some((t) => typeof t !== "string")) {
      return fail("tagIds", "Seleccione etiquetas válidas")
    }
    campos.tagIds = [...new Set(body.tagIds as string[])]
  }

  return { ok: true, value: campos }
}

// ─── Tags ────────────────────────────────────────────────────────────────────────────────

export interface TagValido {
  nombre: string
  slug: string
}

/**
 * Los tags son planos: no aceptan `parentId` ni `nivel` (no participan de la jerarquía). Un
 * body que los traiga se rechaza en vez de ignorarlos en silencio.
 */
export function validarTag(body: unknown): Resultado<TagValido> {
  if (!esObjeto(body)) return fail("body", "Datos inválidos")
  if ("parentId" in body || "nivel" in body) {
    return fail("parentId", "Las etiquetas no tienen jerarquía")
  }

  const crudo = body.nombre
  if (typeof crudo !== "string") return fail("nombre", "Indique el nombre de la etiqueta")
  const nombre = crudo.trim()
  if (!nombre) return fail("nombre", "Indique el nombre de la etiqueta")
  if (nombre.length > NOMBRE_MAX) return fail("nombre", `El nombre no puede superar los ${NOMBRE_MAX} caracteres`)

  const slug = slugify(nombre)
  if (!esSlugValido(slug)) return fail("nombre", "El nombre tiene que incluir al menos una letra o un número")

  return { ok: true, value: { nombre, slug } }
}

// ─── Nombre y SKU (contrato: la misma regla en vidriera, bot y búsqueda) ──────────────────

const noVacio = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim()
  return s.length > 0 ? s : null
}

export interface ProductoAlegra {
  name: string
  description?: string | null
  code?: string | null
}

/** overlay.nombre → alegra.description → alegra.name. Vaciar el nombre propio vuelve al default. */
export function nombreEfectivo(
  nombreOverlay: string | null | undefined,
  producto: ProductoAlegra,
): string {
  return noVacio(nombreOverlay) ?? noVacio(producto.description) ?? producto.name
}

/** alegra.code si tiene valor, si no alegra.name (que en la práctica ES el código). */
export function skuEfectivo(producto: ProductoAlegra): string {
  return noVacio(producto.code) ?? producto.name
}

/**
 * El mismo coalesce, en SQL. Vive acá y no en TypeScript porque se usa en el SELECT, en el
 * ORDER BY y en el WHERE de la búsqueda: si el nombre exhibido se calculara en TS mientras el
 * ORDER BY ordena por `name`, el orden y la paginación dejarían de corresponderse con lo que
 * el usuario ve.
 */
export const nombreEfectivoSql = (overlayNombre: SQL | unknown, productoDescripcion: SQL | unknown, productoName: SQL | unknown): SQL =>
  sql`coalesce(nullif(btrim(${overlayNombre}), ''), nullif(btrim(${productoDescripcion}), ''), ${productoName})`

export const skuEfectivoSql = (productoCode: SQL | unknown, productoName: SQL | unknown): SQL =>
  sql`coalesce(nullif(btrim(${productoCode}), ''), ${productoName})`

// ─── Publicado (derivado, nunca una columna) ─────────────────────────────────────────────

export type MotivoNoPublicado = "oculto" | "inactivo_en_alegra" | "sin_precio"

export interface EstadoPublicacion {
  /** overlay.visible; sin fila de overlay es false (fail-closed). */
  visible: boolean
  /** catalog_products.status — "visto en la última corrida del sync", NO el estado de Alegra. */
  status: string
  /** catalog_products.alegra_status — el estado que le puso Alegra. null = sin sincronizar aún. */
  alegraStatus: string | null
  /** catalog_products.prices tal cual viene de la sync. */
  prices: unknown
}

/** Al menos un precio de lista mayor a cero. */
export function tienePrecio(prices: unknown): boolean {
  if (!Array.isArray(prices)) return false
  return prices.some((p) => {
    const crudo = (p as { price?: unknown })?.price
    const n = typeof crudo === "string" ? Number(crudo) : crudo
    return typeof n === "number" && Number.isFinite(n) && n > 0
  })
}

/**
 * TODOS los motivos que aplican, no el primero: un producto puede estar oculto Y dado de baja
 * en Alegra a la vez, y el admin tiene que mostrar los dos. Array vacío = publicado.
 *
 * Tener foto NO es condición de publicación en esta entrega.
 */
export function motivoNoPublicado(fila: EstadoPublicacion): MotivoNoPublicado[] {
  const motivos: MotivoNoPublicado[] = []
  if (!fila.visible) motivos.push("oculto")
  // Dos cosas distintas, mismo motivo de cara al usuario: que Alegra lo haya dado de baja, o que
  // haya desaparecido del catálogo entre dos corridas. En los dos casos no se puede vender.
  if (fila.status !== "active" || fila.alegraStatus === "inactive") motivos.push("inactivo_en_alegra")
  if (!tienePrecio(fila.prices)) motivos.push("sin_precio")
  return motivos
}

export const estaPublicado = (fila: EstadoPublicacion): boolean => motivoNoPublicado(fila).length === 0

// Los textos de estos motivos viven en el panel (src/components/admin/catalogo/tipos.ts):
// son presentación y sólo los usa la UI, y traerlos desde acá metería este módulo —y con él
// drizzle— dentro del bundle del navegador.

export type { FotoOverlay } from "@/db/schema"
