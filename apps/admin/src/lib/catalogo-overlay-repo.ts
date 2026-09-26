import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import {
  catalogCategories,
  catalogOverlay,
  catalogOverlayTags,
  catalogProducts,
  catalogSyncLog,
  shopCategories,
  shopSyncPing,
  shopTags,
} from "@/db/schema"
import {
  motivoNoPublicado,
  nombreEfectivoSql,
  slugify,
  skuEfectivoSql,
  validarCategoria,
  validarMovimiento,
  validarTag,
  type CategoriaValida,
  type FotoOverlay,
  type MotivoNoPublicado,
  type NodoCategoria,
  type TagValido,
} from "@/lib/catalogo-overlay"

// Acceso a datos del catálogo comercial. TODO filtra por el `tenantId` del guard, nunca por uno
// que venga del body: un id de otro tenant se comporta igual que uno inexistente (not_found).
//
// REGLA NO NEGOCIABLE: toda escritura del overlay setea `updated_at = now()` de POSTGRES.
// Dos motivos, los dos ya mordieron en este repo o en uno hermano:
//   1. drizzle no lo hace solo y `DEFAULT now()` sólo cubre el INSERT ⇒ un UPDATE que se olvide
//      deja un producto cuyo cambio NUNCA viaja al Shop (el delta va por updated_at).
//   2. `new Date()` de Node usa el reloj de la instancia de Vercel. Con skew entre instancias,
//      un timestamp "del pasado" queda debajo de un cursor ya consumido y tampoco viaja nunca.
//      now() de Postgres es un solo reloj para todas las instancias.
//
// Y una consecuencia fácil de pasar por alto: los tags de un producto viven en OTRA tabla
// (catalog_overlay_tags), así que la regla de arriba no los cubre sola. Toda escritura sobre la
// relación bumpea catalog_overlay.updated_at EN LA MISMA TRANSACCIÓN.

const AHORA = sql`now()`

export type CategoriaRow = typeof shopCategories.$inferSelect
export type OverlayRow = typeof catalogOverlay.$inferSelect
export type TagRow = typeof shopTags.$inferSelect

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
type Ejecutor = Db | Tx

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (id: string): boolean => UUID_RE.test(id)

type Invalido = { kind: "invalid"; campo: string; error: string }
export type ResultadoCategoria =
  | { kind: "ok"; row: CategoriaRow }
  | { kind: "not_found" }
  | { kind: "duplicado" }
  | { kind: "con_hijas" }
  | Invalido
export type ResultadoTag = { kind: "ok"; row: TagRow } | { kind: "not_found" } | { kind: "duplicado" } | Invalido

function esUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true
  }
  return false
}

// ─── Categorías ──────────────────────────────────────────────────────────────────────────

export async function listarCategorias(tenantId: string): Promise<CategoriaRow[]> {
  return getDb()
    .select()
    .from(shopCategories)
    .where(eq(shopCategories.tenantId, tenantId))
    .orderBy(asc(shopCategories.nivel), asc(shopCategories.parentId), asc(shopCategories.orden), asc(shopCategories.nombre))
}

export interface CategoriaConUso {
  id: string
  parentId: string | null
  nombre: string
  slug: string
  orden: number
  nivel: number
  activa: boolean
  /** Productos asignados DIRECTAMENTE a esta categoría (no incluye los del subárbol). */
  productos: number
  /** KEY del objeto en R2. La url se compone al servir, nunca se guarda. */
  imagenKey: string | null
}

/**
 * El árbol con el conteo de productos por categoría: es el número que la confirmación de
 * borrado tiene que decir ANTES de confirmar (REQ-TAX-06), y el que la UI muestra al lado de
 * cada rama. "Sin clasificar" NO sale de acá: es un cajón, no una fila de la taxonomía.
 */
export async function listarCategoriasConUso(tenantId: string): Promise<CategoriaConUso[]> {
  return getDb()
    .select({
      id: shopCategories.id,
      parentId: shopCategories.parentId,
      nombre: shopCategories.nombre,
      slug: shopCategories.slug,
      orden: shopCategories.orden,
      imagenKey: shopCategories.imagenKey,
      nivel: shopCategories.nivel,
      activa: shopCategories.activa,
      productos: sql<number>`count(${catalogOverlay.id})::int`,
    })
    .from(shopCategories)
    .leftJoin(
      catalogOverlay,
      and(eq(catalogOverlay.categoriaId, shopCategories.id), eq(catalogOverlay.tenantId, tenantId)),
    )
    .where(eq(shopCategories.tenantId, tenantId))
    .groupBy(shopCategories.id)
    .orderBy(asc(shopCategories.nivel), asc(shopCategories.parentId), asc(shopCategories.orden), asc(shopCategories.nombre))
}

/**
 * ¿La categoría existe EN ESTE tenant? La FK de `catalog_overlay.categoria_id` apunta a
 * `shop_categories.id` sin mirar el tenant, así que sin este chequeo un id ajeno sería aceptado
 * por la base: es exactamente el agujero de aislamiento que REQ-MT-01 prohíbe.
 */
export async function categoriaPropia(
  tenantId: string,
  id: string,
  ejecutor: Ejecutor = getDb(),
): Promise<boolean> {
  if (!esUuid(id)) return false
  const [row] = await ejecutor
    .select({ id: shopCategories.id })
    .from(shopCategories)
    .where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
  return !!row
}

const aNodos = (rows: { id: string; parentId: string | null }[]): NodoCategoria[] =>
  rows.map((r) => ({ id: r.id, parentId: r.parentId }))

async function nodosDelTenant(ejecutor: Ejecutor, tenantId: string): Promise<NodoCategoria[]> {
  const rows = await ejecutor
    .select({ id: shopCategories.id, parentId: shopCategories.parentId })
    .from(shopCategories)
    .where(eq(shopCategories.tenantId, tenantId))
  return aNodos(rows)
}


/**
 * La key de la imagen tiene que vivir bajo el prefijo de ESTE tenant.
 *
 * `validarCategoria` es puro y no conoce el tenant, así que sólo puede exigir el prefijo
 * `categorias/`. Sin esta segunda comprobación, un PATCH podría apuntar la categoría de un tenant
 * a la imagen de otro, que es justamente lo que el bucket compartido hace posible.
 */
function imagenDeOtroTenant(tenantId: string, imagenKey: string | null): boolean {
  return imagenKey !== null && !imagenKey.startsWith(`categorias/${tenantId}/`)
}

export async function crearCategoria(tenantId: string, body: unknown): Promise<ResultadoCategoria> {
  const v = validarCategoria(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  if (imagenDeOtroTenant(tenantId, v.value.imagenKey)) {
    return { kind: "invalid", campo: "imagenKey", error: "Imagen inválida" }
  }
  return escribirCategoria(tenantId, null, v.value)
}

export async function actualizarCategoria(tenantId: string, id: string, body: unknown): Promise<ResultadoCategoria> {
  if (!esUuid(id)) return { kind: "not_found" }
  const db = getDb()
  const [actual] = await db
    .select()
    .from(shopCategories)
    .where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
  if (!actual) return { kind: "not_found" }

  const v = validarCategoria(body, {
    nombre: actual.nombre,
    slug: actual.slug,
    parentId: actual.parentId,
    orden: actual.orden,
    activa: actual.activa,
    imagenKey: actual.imagenKey,
    imagenAlt: actual.imagenAlt,
  })
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  if (imagenDeOtroTenant(tenantId, v.value.imagenKey)) {
    return { kind: "invalid", campo: "imagenKey", error: "Imagen inválida" }
  }
  return escribirCategoria(tenantId, id, v.value)
}

/**
 * Alta y edición comparten la validación de jerarquía: el movimiento se valida ANTES de
 * escribir nada, con el árbol entero del tenant en la mano (ciclo y tope de 3 niveles).
 */
async function escribirCategoria(
  tenantId: string,
  id: string | null,
  valor: CategoriaValida,
): Promise<ResultadoCategoria> {
  const db = getDb()
  const nodos = await nodosDelTenant(db, tenantId)
  // El padre tiene que ser del mismo tenant: si no está en `nodos`, validarMovimiento lo
  // rechaza como inexistente, que es exactamente el comportamiento buscado ante un id ajeno.
  const mov = validarMovimiento(nodos, id, valor.parentId)
  if (!mov.ok) return { kind: "invalid", campo: mov.campo, error: mov.error }

  try {
    if (id === null) {
      const [row] = await db
        .insert(shopCategories)
        .values({ tenantId, ...valor, nivel: mov.value.nivel })
        .returning()
      return { kind: "ok", row }
    }
    const [row] = await db
      .update(shopCategories)
      .set({ ...valor, nivel: mov.value.nivel, updatedAt: sql`now()` })
      .where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
      .returning()
    return row ? { kind: "ok", row } : { kind: "not_found" }
  } catch (err) {
    if (esUniqueViolation(err)) return { kind: "duplicado" }
    throw err
  }
}

/** Cuántos productos y cuántas hijas quedarían afectados: se informa ANTES de confirmar. */
export async function impactoBorrarCategoria(
  tenantId: string,
  id: string,
): Promise<{ productos: number; hijas: number } | null> {
  if (!esUuid(id)) return null
  const db = getDb()
  const [cat] = await db
    .select({ id: shopCategories.id })
    .from(shopCategories)
    .where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
  if (!cat) return null

  const [{ productos }] = await db
    .select({ productos: sql<number>`count(*)::int` })
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, tenantId), eq(catalogOverlay.categoriaId, id)))
  const [{ hijas }] = await db
    .select({ hijas: sql<number>`count(*)::int` })
    .from(shopCategories)
    .where(and(eq(shopCategories.tenantId, tenantId), eq(shopCategories.parentId, id)))
  return { productos, hijas }
}

/**
 * Borrar una categoría. En la MISMA transacción y EN ESTE ORDEN:
 *   1. refrescar el updated_at de sus productos,
 *   2. recién después el DELETE.
 *
 * Invertirlo es un bug silencioso: el ON DELETE SET NULL de la FK ya borró la referencia, así
 * que después del DELETE los productos afectados son imposibles de encontrar y el Shop queda
 * con productos apuntando a una categoría fantasma.
 *
 * Los productos NO se despublican ni pierden nombre, tags ni fotos: pasan a "Sin clasificar".
 * Con hijas se rechaza (409) — el ON DELETE RESTRICT lo garantiza también en la DB.
 */
export async function borrarCategoria(tenantId: string, id: string): Promise<ResultadoCategoria> {
  if (!esUuid(id)) return { kind: "not_found" }
  return getDb().transaction(async (tx) => {
    const [cat] = await tx
      .select()
      .from(shopCategories)
      .where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
    if (!cat) return { kind: "not_found" } as ResultadoCategoria

    const [hija] = await tx
      .select({ id: shopCategories.id })
      .from(shopCategories)
      .where(and(eq(shopCategories.tenantId, tenantId), eq(shopCategories.parentId, id)))
      .limit(1)
    if (hija) return { kind: "con_hijas" } as ResultadoCategoria

    // 1. Arrastrar los productos al delta ANTES de perder la referencia.
    await tx
      .update(catalogOverlay)
      .set({ updatedAt: AHORA })
      .where(and(eq(catalogOverlay.tenantId, tenantId), eq(catalogOverlay.categoriaId, id)))
    // 2. El DELETE (la FK deja categoria_id en NULL → "Sin clasificar").
    await tx.delete(shopCategories).where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
    return { kind: "ok", row: cat } as ResultadoCategoria
  })
}

export type ResultadoOrden = { kind: "ok" } | { kind: "conjunto_invalido" } | { kind: "invalid"; campo: string; error: string }

/**
 * Reordenar un nivel completo: `ids` tiene que ser EXACTAMENTE el conjunto de hijos de ese
 * padre en ese tenant. Un conjunto incompleto o con repetidos se rechaza entero, sin estados a
 * medias — así "el cliente mandó una lista vieja" es un 409 y no un orden corrupto.
 */
export async function reordenarNivel(
  tenantId: string,
  parentId: string | null,
  ids: string[],
): Promise<ResultadoOrden> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !esUuid(id))) {
    return { kind: "invalid", campo: "ids", error: "Datos inválidos" }
  }
  if (parentId !== null && !esUuid(parentId)) return { kind: "conjunto_invalido" }
  if (new Set(ids).size !== ids.length) return { kind: "conjunto_invalido" }

  return getDb().transaction(async (tx) => {
    const hermanas = await tx
      .select({ id: shopCategories.id })
      .from(shopCategories)
      .where(
        and(
          eq(shopCategories.tenantId, tenantId),
          parentId === null ? sql`${shopCategories.parentId} is null` : eq(shopCategories.parentId, parentId),
        ),
      )
    const actuales = new Set(hermanas.map((h) => h.id))
    if (actuales.size !== ids.length || ids.some((id) => !actuales.has(id))) {
      return { kind: "conjunto_invalido" } as ResultadoOrden
    }
    for (const [i, id] of ids.entries()) {
      await tx
        .update(shopCategories)
        .set({ orden: i, updatedAt: sql`now()` })
        .where(and(eq(shopCategories.id, id), eq(shopCategories.tenantId, tenantId)))
    }
    return { kind: "ok" } as ResultadoOrden
  })
}

// ─── Filtros del listado (compartidos con las masivas por descriptor) ─────────────────────

export interface FiltrosAdmin {
  /**
   * Texto libre. Busca sobre el nombre efectivo, el SKU (code, y el `name` de Alegra que es el
   * código cuando no hay code) y las dos descripciones: lo exhibido y lo viejo tienen que ser
   * igual de encontrables.
   */
  q?: string
  /** uuid de categoría (incluye su SUBÁRBOL) o "sin" (sin clasificar, incluye overlay ausente). */
  categoria?: string
  estado?: "visible" | "oculto"
  foto?: "con" | "sin"
  /** "sin" = sin nombre propio cargado. */
  nombre?: "sin"
  /** Estado del producto en Alegra. */
  alegra?: "active" | "inactive"
  /** "sin" = sin precio de lista mayor a cero en Alegra (uno de los motivos de no publicado). */
  precio?: "con" | "sin"
  /** "con" = stock mayor a cero en el último sync. Sin dato de stock cuenta como "sin". */
  stock?: "con" | "sin"
  /** uuid de un tag. */
  tag?: string
}

/** Ids de la categoría y todo su subárbol (tope de 3 niveles, pero el CTE no depende de eso). */
const subarbolSql = (tenantId: string, categoriaId: string): SQL => sql`
  WITH RECURSIVE arbol AS (
    SELECT id FROM ${shopCategories} WHERE id = ${categoriaId} AND tenant_id = ${tenantId}
    UNION ALL
    SELECT c.id FROM ${shopCategories} c JOIN arbol a ON c.parent_id = a.id
  )
  SELECT id FROM arbol
`

/**
 * El MISMO WHERE que usa el listado del admin, para que una masiva "sobre todo lo que coincide
 * con el filtro" se re-evalúe en el servidor en una sola sentencia, sin que el cliente mande
 * ~5959 ids. Se aplica sobre `catalog_products p LEFT JOIN catalog_overlay o`.
 */
export function condicionesListado(tenantId: string, f: FiltrosAdmin): SQL[] {
  const cond: SQL[] = [sql`p.tenant_id = ${tenantId}`]

  const q = (f.q ?? "").trim()
  if (q) {
    const like = `%${q}%`
    const nombre = nombreEfectivoSql(sql`o.nombre`, sql`p.description`, sql`p.name`, sql`p.code`)
    cond.push(sql`(
      unaccent(${nombre}) ILIKE unaccent(${like})
      OR unaccent(p.code) ILIKE unaccent(${like})
      OR unaccent(p.name) ILIKE unaccent(${like})
      OR unaccent(p.description) ILIKE unaccent(${like})
      OR unaccent(o.descripcion) ILIKE unaccent(${like})
    )`)
  }

  if (f.categoria === "sin") cond.push(sql`o.categoria_id IS NULL`)
  else if (f.categoria && esUuid(f.categoria)) {
    cond.push(sql`o.categoria_id IN (${subarbolSql(tenantId, f.categoria)})`)
  }

  if (f.estado === "visible") cond.push(sql`coalesce(o.visible, false) = true`)
  else if (f.estado === "oculto") cond.push(sql`coalesce(o.visible, false) = false`)

  if (f.foto === "sin") cond.push(sql`coalesce(jsonb_array_length(o.fotos), 0) = 0`)
  else if (f.foto === "con") cond.push(sql`coalesce(jsonb_array_length(o.fotos), 0) > 0`)

  if (f.nombre === "sin") cond.push(sql`(o.nombre IS NULL OR btrim(o.nombre) = '')`)

  // `p.status` es "visto en la última corrida", NO el estado de Alegra: ese vive en
  // `alegra_status`. El filtro apuntaba a la columna equivocada, así que "inactivo" no devolvía
  // nunca nada. Se acepta null como activo: son los que no pasaron por el sync nuevo todavía.
  if (f.alegra === "active") {
    cond.push(sql`(p.alegra_status IS NULL OR p.alegra_status <> 'inactive')`)
  } else if (f.alegra === "inactive") {
    cond.push(sql`p.alegra_status = 'inactive'`)
  }

  // "Sin precio": la misma regla que `tienePrecio()` en TypeScript, pero en SQL, porque el
  // filtro y el conteo se resuelven en Postgres. El chequeo de formato antes del cast evita que
  // un precio guardado como texto raro tumbe la query entera.
  if (f.precio === "sin" || f.precio === "con") {
    const conPrecio = sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.prices) e
      WHERE jsonb_typeof(p.prices) = 'array'
        AND (e->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (e->>'price')::numeric > 0
    )`
    cond.push(f.precio === "con" ? conPrecio : sql`NOT ${conPrecio}`)
  }

  if (f.stock === "con") cond.push(sql`coalesce(p.stock, 0) > 0`)
  else if (f.stock === "sin") cond.push(sql`coalesce(p.stock, 0) <= 0`)

  if (f.tag && esUuid(f.tag)) {
    cond.push(sql`EXISTS (
      SELECT 1 FROM ${catalogOverlayTags} cot WHERE cot.overlay_id = o.id AND cot.tag_id = ${f.tag}
    )`)
  }

  return cond
}

const whereListado = (tenantId: string, f: FiltrosAdmin): SQL =>
  sql.join(condicionesListado(tenantId, f), sql` AND `)

/** `('a', 'b')` con un parámetro por elemento: drizzle bindearía el array entero como uno solo. */
const listaSql = (valores: string[]): SQL => sql`(${sql.join(valores.map((v) => sql`${v}`), sql`, `)})`

// ─── Edición por producto ────────────────────────────────────────────────────────────────

export interface CamposOverlay {
  visible?: boolean
  nombre?: string | null
  descripcion?: string | null
  categoriaId?: string | null
  orden?: number | null
  fotos?: FotoOverlay[]
}

/**
 * Upsert del overlay de un producto. Persiste SÓLO los campos enviados: lo que no viene queda
 * como estaba (la edición del nombre no puede pisar la categoría ni las fotos). Nunca toca
 * precio, stock ni alegra_id — no viven acá.
 */
export async function guardarOverlay(
  tenantId: string,
  alegraId: string,
  campos: CamposOverlay,
  updatedBy: string | null = null,
  ejecutor: Ejecutor = getDb(),
): Promise<OverlayRow> {
  const set: Record<string, unknown> = {}
  if (campos.visible !== undefined) set.visible = campos.visible
  if (campos.nombre !== undefined) set.nombre = campos.nombre
  if (campos.descripcion !== undefined) set.descripcion = campos.descripcion
  if (campos.categoriaId !== undefined) set.categoriaId = campos.categoriaId
  if (campos.orden !== undefined) set.orden = campos.orden
  if (campos.fotos !== undefined) set.fotos = campos.fotos

  const [row] = await ejecutor
    .insert(catalogOverlay)
    .values({ tenantId, alegraId, updatedBy, ...set, updatedAt: AHORA })
    .onConflictDoUpdate({
      target: [catalogOverlay.tenantId, catalogOverlay.alegraId],
      set: { ...set, updatedBy, updatedAt: AHORA },
    })
    .returning()
  return row
}

export async function leerOverlay(tenantId: string, alegraId: string): Promise<OverlayRow | null> {
  const [row] = await getDb()
    .select()
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, tenantId), eq(catalogOverlay.alegraId, alegraId)))
  return row ?? null
}

// ─── Acciones masivas por descriptor de filtro ───────────────────────────────────────────

export const TOPE_SELECCION = 500

export type Seleccion =
  | { tipo: "ids"; alegraIds: string[] }
  | { tipo: "filtro"; filtros: FiltrosAdmin; excluir?: string[] }

export type ResultadoMasiva = { kind: "ok"; afectados: number } | Invalido

function validarSeleccion(seleccion: Seleccion): Invalido | null {
  if (seleccion.tipo === "ids") {
    if (!Array.isArray(seleccion.alegraIds) || seleccion.alegraIds.length === 0) {
      return { kind: "invalid", campo: "alegraIds", error: "Seleccione al menos un producto" }
    }
    if (seleccion.alegraIds.length > TOPE_SELECCION) {
      return { kind: "invalid", campo: "alegraIds", error: `No se pueden enviar más de ${TOPE_SELECCION} productos por identificador` }
    }
    return null
  }
  if ((seleccion.excluir?.length ?? 0) > TOPE_SELECCION) {
    return { kind: "invalid", campo: "excluir", error: `No se pueden excluir más de ${TOPE_SELECCION} productos` }
  }
  return null
}

/** `SELECT p.alegra_id` del conjunto seleccionado, para usar como subquery de un INSERT … SELECT. */
function seleccionSql(tenantId: string, seleccion: Seleccion): SQL {
  if (seleccion.tipo === "ids") {
    return sql`
      SELECT p.alegra_id FROM ${catalogProducts} p
      LEFT JOIN ${catalogOverlay} o ON (o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id)
      WHERE p.tenant_id = ${tenantId} AND p.alegra_id IN ${listaSql(seleccion.alegraIds)}
    `
  }
  const excluir = seleccion.excluir ?? []
  return sql`
    SELECT p.alegra_id FROM ${catalogProducts} p
    LEFT JOIN ${catalogOverlay} o ON (o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id)
    WHERE ${whereListado(tenantId, seleccion.filtros)}
    ${excluir.length > 0 ? sql`AND p.alegra_id NOT IN ${listaSql(excluir)}` : sql``}
  `
}

/**
 * Publicar / ocultar / asignar categoría en masa. UNA sola sentencia:
 * `INSERT … SELECT … ON CONFLICT DO UPDATE` crea las filas de overlay que falten (el overlay es
 * esparso: la mayoría de los productos no tienen fila todavía) y actualiza las que existan, sin
 * traer un solo id a Node. Atómica por definición: o se aplica a todo el conjunto o a ninguno.
 */
export async function masivaOverlay(
  tenantId: string,
  seleccion: Seleccion,
  accion: { tipo: "visible"; valor: boolean } | { tipo: "categoria"; categoriaId: string | null },
  updatedBy: string | null = null,
  ejecutor: Ejecutor = getDb(),
): Promise<ResultadoMasiva> {
  const malo = validarSeleccion(seleccion)
  if (malo) return malo
  // Una categoría de otro tenant tiene que comportarse igual que una inexistente: la FK apunta
  // a shop_categories.id sin mirar el tenant y sola no alcanza (REQ-MT-01).
  if (accion.tipo === "categoria" && accion.categoriaId !== null && !(await categoriaPropia(tenantId, accion.categoriaId))) {
    return { kind: "invalid", campo: "categoriaId", error: "Seleccione una categoría válida" }
  }

  const sel = seleccionSql(tenantId, seleccion)
  const columna = accion.tipo === "visible" ? sql`visible` : sql`categoria_id`
  const valor = accion.tipo === "visible" ? sql`${accion.valor}` : sql`${accion.categoriaId}::uuid`

  const filas = await ejecutor.execute(sql`
    INSERT INTO ${catalogOverlay} (tenant_id, alegra_id, ${columna}, updated_by, updated_at)
    SELECT ${tenantId}, s.alegra_id, ${valor}, ${updatedBy}, now() FROM (${sel}) s
    ON CONFLICT (tenant_id, alegra_id) DO UPDATE
      SET ${columna} = excluded.${columna}, updated_by = excluded.updated_by, updated_at = now()
    RETURNING 1
  `)
  return { kind: "ok", afectados: filas.length }
}

/** Cuántos productos matchea el descriptor. Es el número que confirma la UI (lo cuenta el servidor). */
export async function contarSeleccion(tenantId: string, seleccion: Seleccion): Promise<number> {
  const malo = validarSeleccion(seleccion)
  if (malo) return 0
  const filas = await getDb().execute(sql`SELECT count(*)::int AS n FROM (${seleccionSql(tenantId, seleccion)}) s`)
  return Number((filas[0] as { n: number }).n)
}

// ─── Tags ────────────────────────────────────────────────────────────────────────────────

export interface TagConUso extends TagValido {
  id: string
  productos: number
}

/** Todos los tags del tenant con su conteo EXACTO de productos (0 incluido). */
export async function listarTags(tenantId: string): Promise<TagConUso[]> {
  const rows = await getDb()
    .select({
      id: shopTags.id,
      nombre: shopTags.nombre,
      slug: shopTags.slug,
      productos: sql<number>`count(${catalogOverlayTags.overlayId})::int`,
    })
    .from(shopTags)
    .leftJoin(catalogOverlayTags, eq(catalogOverlayTags.tagId, shopTags.id))
    .where(eq(shopTags.tenantId, tenantId))
    .groupBy(shopTags.id)
    .orderBy(asc(shopTags.nombre))
  return rows
}

export async function crearTag(tenantId: string, body: unknown): Promise<ResultadoTag> {
  const v = validarTag(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  try {
    const [row] = await getDb().insert(shopTags).values({ tenantId, ...v.value }).returning()
    return { kind: "ok", row }
  } catch (err) {
    if (esUniqueViolation(err)) return { kind: "duplicado" }
    throw err
  }
}

/**
 * Renombrar. Cambia nombre y slug y NO TOCA NINGUNA FILA DE PRODUCTO: es el punto entero de
 * que los tags tengan entidad propia. Los productos referencian el uuid, que no cambia, así
 * que un rename sobre 800 productos no empuja ni uno solo al delta del Shop — el nombre nuevo
 * le llega por el reemplazo atómico del diccionario de tags.
 */
export async function renombrarTag(tenantId: string, id: string, body: unknown): Promise<ResultadoTag> {
  if (!esUuid(id)) return { kind: "not_found" }
  const v = validarTag(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  try {
    const [row] = await getDb()
      .update(shopTags)
      .set({ ...v.value, updatedAt: sql`now()` })
      .where(and(eq(shopTags.id, id), eq(shopTags.tenantId, tenantId)))
      .returning()
    return row ? { kind: "ok", row } : { kind: "not_found" }
  } catch (err) {
    if (esUniqueViolation(err)) return { kind: "duplicado" }
    throw err
  }
}

/** A cuántos productos les va a sacar el tag. Se informa ANTES de confirmar. */
export async function impactoBorrarTag(tenantId: string, id: string): Promise<number | null> {
  if (!esUuid(id)) return null
  const db = getDb()
  const [tag] = await db
    .select({ id: shopTags.id })
    .from(shopTags)
    .where(and(eq(shopTags.id, id), eq(shopTags.tenantId, tenantId)))
  if (!tag) return null
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogOverlayTags)
    .where(eq(catalogOverlayTags.tagId, id))
  return n
}

/**
 * Borrar un tag. En la MISMA transacción y EN ESTE ORDEN:
 *   1. bumpear el updated_at de los productos que lo tenían,
 *   2. recién después el DELETE (que cascadea la relación).
 *
 * Misma clase de bug que borrarCategoria, por la misma razón: después del DELETE las filas de
 * relación ya no existen y los productos afectados son imposibles de encontrar. Y acá el
 * arrastre SÍ corresponde: el conjunto de tags de esos productos cambió de verdad.
 */
export async function borrarTag(tenantId: string, id: string): Promise<ResultadoTag> {
  if (!esUuid(id)) return { kind: "not_found" }
  return getDb().transaction(async (tx) => {
    const [tag] = await tx
      .select()
      .from(shopTags)
      .where(and(eq(shopTags.id, id), eq(shopTags.tenantId, tenantId)))
    if (!tag) return { kind: "not_found" } as ResultadoTag

    await tx.execute(sql`
      UPDATE ${catalogOverlay} SET updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND id IN (SELECT overlay_id FROM ${catalogOverlayTags} WHERE tag_id = ${id})
    `)
    await tx.delete(shopTags).where(and(eq(shopTags.id, id), eq(shopTags.tenantId, tenantId)))
    return { kind: "ok", row: tag } as ResultadoTag
  })
}

/** Los tags de un producto, en el orden en que los muestra el panel. */
export async function tagsDeProducto(tenantId: string, alegraId: string): Promise<TagRow[]> {
  return getDb()
    .select({
      id: shopTags.id,
      tenantId: shopTags.tenantId,
      nombre: shopTags.nombre,
      slug: shopTags.slug,
      createdAt: shopTags.createdAt,
      updatedAt: shopTags.updatedAt,
    })
    .from(catalogOverlayTags)
    .innerJoin(shopTags, eq(shopTags.id, catalogOverlayTags.tagId))
    .innerJoin(catalogOverlay, eq(catalogOverlay.id, catalogOverlayTags.overlayId))
    .where(and(eq(catalogOverlay.tenantId, tenantId), eq(catalogOverlay.alegraId, alegraId)))
    .orderBy(asc(shopTags.nombre))
}

/** Sólo los tags que existen EN ESTE tenant: un uuid ajeno se descarta, no se asigna. */
async function tagsPropios(ejecutor: Ejecutor, tenantId: string, tagIds: string[]): Promise<string[]> {
  const validos = tagIds.filter((id) => typeof id === "string" && esUuid(id))
  if (validos.length === 0) return []
  const rows = await ejecutor
    .select({ id: shopTags.id })
    .from(shopTags)
    .where(and(eq(shopTags.tenantId, tenantId), inArray(shopTags.id, validos)))
  return rows.map((r) => r.id)
}

/**
 * Reemplaza el conjunto de tags de UN producto. Crea la fila de overlay si no existía y bumpea
 * su updated_at en la misma transacción — la relación vive en otra tabla, así que sin esto el
 * cambio de tags nunca llegaría al Shop.
 */
export async function asignarTagsProducto(
  tenantId: string,
  alegraId: string,
  tagIds: string[],
  updatedBy: string | null = null,
): Promise<{ kind: "ok"; tagIds: string[] }> {
  return getDb().transaction(async (tx) => {
    const propios = await tagsPropios(tx, tenantId, tagIds)
    const overlay = await guardarOverlay(tenantId, alegraId, {}, updatedBy, tx)
    await tx.delete(catalogOverlayTags).where(eq(catalogOverlayTags.overlayId, overlay.id))
    if (propios.length > 0) {
      await tx.insert(catalogOverlayTags).values(propios.map((tagId) => ({ overlayId: overlay.id, tagId })))
    }
    return { kind: "ok", tagIds: propios }
  })
}

export type AccionTagMasiva = "agregar" | "quitar"

/**
 * Agregar o quitar un tag sobre una selección. Primero crea las filas de overlay que falten
 * (con la misma sentencia de las masivas, porque una selección puede incluir productos que
 * nunca fueron tocados) y recién después escribe la relación. Todo en una transacción, y el
 * updated_at de los afectados avanza en los dos pasos.
 */
export async function masivaTags(
  tenantId: string,
  seleccion: Seleccion,
  tagId: string,
  accion: AccionTagMasiva,
  updatedBy: string | null = null,
): Promise<ResultadoMasiva> {
  const malo = validarSeleccion(seleccion)
  if (malo) return malo
  if (!esUuid(tagId)) return { kind: "invalid", campo: "tagId", error: "Seleccione una etiqueta válida" }

  return getDb().transaction(async (tx) => {
    const [tag] = await tx
      .select({ id: shopTags.id })
      .from(shopTags)
      .where(and(eq(shopTags.id, tagId), eq(shopTags.tenantId, tenantId)))
    if (!tag) return { kind: "invalid", campo: "tagId", error: "La etiqueta no existe" } as ResultadoMasiva

    const sel = seleccionSql(tenantId, seleccion)

    if (accion === "agregar") {
      // 1. Crear las filas de overlay que falten (y bumpear las existentes).
      await tx.execute(sql`
        INSERT INTO ${catalogOverlay} (tenant_id, alegra_id, updated_by, updated_at)
        SELECT ${tenantId}, s.alegra_id, ${updatedBy}, now() FROM (${sel}) s
        ON CONFLICT (tenant_id, alegra_id) DO UPDATE SET updated_by = excluded.updated_by, updated_at = now()
      `)
      // 2. La relación. ON CONFLICT DO NOTHING ⇒ agregar dos veces el mismo tag no es error.
      const filas = await tx.execute(sql`
        INSERT INTO ${catalogOverlayTags} (overlay_id, tag_id)
        SELECT o.id, ${tagId}::uuid FROM ${catalogOverlay} o
        WHERE o.tenant_id = ${tenantId} AND o.alegra_id IN (SELECT s.alegra_id FROM (${sel}) s)
        ON CONFLICT DO NOTHING
        RETURNING 1
      `)
      return { kind: "ok", afectados: filas.length } as ResultadoMasiva
    }

    // Quitar: sólo toca productos que YA tienen overlay (si no lo tienen, no tienen el tag).
    await tx.execute(sql`
      DELETE FROM ${catalogOverlayTags} cot
      USING ${catalogOverlay} o
      WHERE cot.overlay_id = o.id AND cot.tag_id = ${tagId}
        AND o.tenant_id = ${tenantId}
        AND o.alegra_id IN (SELECT s.alegra_id FROM (${sel}) s)
    `)
    const filas = await tx.execute(sql`
      UPDATE ${catalogOverlay} SET updated_at = now(), updated_by = ${updatedBy}
      WHERE tenant_id = ${tenantId} AND alegra_id IN (SELECT s.alegra_id FROM (${sel}) s)
      RETURNING 1
    `)
    return { kind: "ok", afectados: filas.length } as ResultadoMasiva
  })
}

// ─── Listado y ficha del panel ───────────────────────────────────────────────────────────

/** Una fila del listado del admin: lo de Alegra (sólo lectura) + lo editable del overlay. */
export interface ProductoAdmin {
  alegraId: string
  /** Alegra, sólo lectura. */
  code: string | null
  nombreAlegra: string
  descripcionAlegra: string | null
  status: string
  prices: unknown
  stock: string | null
  syncedAt: string | null
  /** Overlay (editable). `null` en nombre/descripción = sin valor propio, cae al de Alegra. */
  nombre: string | null
  descripcion: string | null
  nombreEfectivo: string
  sku: string
  visible: boolean
  categoriaId: string | null
  categoriaNombre: string | null
  orden: number | null
  tagIds: string[]
  fotos: FotoOverlay[]
  actualizadoEn: string | null
  motivos: MotivoNoPublicado[]
}

export type OrdenListado = "nombre" | "nombre-desc" | "actualizado"

export const LIMITE_LISTADO_DEFAULT = 50
export const LIMITE_LISTADO_MAX = 200

interface FilaListadoCruda {
  alegra_id: string
  code: string | null
  name: string
  description: string | null
  status: string
  prices: unknown
  stock: string | null
  synced_at: Date | string | null
  visible: boolean | null
  nombre: string | null
  descripcion: string | null
  categoria_id: string | null
  categoria_nombre: string | null
  orden: number | null
  fotos: FotoOverlay[] | null
  updated_at: Date | string | null
  nombre_efectivo: string
  sku: string
  tag_ids: string[] | null
  alegra_status: string | null
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v)

function aProductoAdmin(f: FilaListadoCruda): ProductoAdmin {
  const visible = f.visible ?? false
  return {
    alegraId: f.alegra_id,
    code: f.code,
    nombreAlegra: f.name,
    descripcionAlegra: f.description,
    status: f.status,
    prices: f.prices,
    stock: f.stock,
    syncedAt: iso(f.synced_at),
    nombre: f.nombre,
    descripcion: f.descripcion,
    nombreEfectivo: f.nombre_efectivo,
    sku: f.sku,
    visible,
    categoriaId: f.categoria_id,
    categoriaNombre: f.categoria_nombre,
    orden: f.orden,
    tagIds: f.tag_ids ?? [],
    fotos: f.fotos ?? [],
    actualizadoEn: iso(f.updated_at),
    // Orientativo: el Shop vuelve a evaluar la regla sobre SU copia y su evaluación es la que manda.
    motivos: motivoNoPublicado({ visible, status: f.status, alegraStatus: f.alegra_status, prices: f.prices }),
  }
}

/** Las columnas del listado y de la ficha son las mismas: una sola definición, un solo orden. */
const columnasListado = sql`
  p.alegra_id, p.code, p.name, p.description, p.status, p.alegra_status, p.prices, p.stock, p.synced_at,
  o.visible, o.nombre, o.descripcion, o.categoria_id, o.orden, o.fotos, o.updated_at,
  c.nombre AS categoria_nombre,
  ${nombreEfectivoSql(sql`o.nombre`, sql`p.description`, sql`p.name`, sql`p.code`)} AS nombre_efectivo,
  ${skuEfectivoSql(sql`p.code`, sql`p.name`)} AS sku,
  coalesce(
    (SELECT array_agg(cot.tag_id::text) FROM ${catalogOverlayTags} cot WHERE cot.overlay_id = o.id),
    '{}'
  ) AS tag_ids
`

const desdeListado = sql`
  FROM ${catalogProducts} p
  LEFT JOIN ${catalogOverlay} o ON (o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id)
  LEFT JOIN ${shopCategories} c ON (c.id = o.categoria_id AND c.tenant_id = p.tenant_id)
`

/**
 * Página del listado del panel. Filtrado, conteo, orden y paginado se resuelven en Postgres:
 * con ~5959 productos, traerlos al navegador para filtrar ahí no es una opción (REQ-ADM-01).
 *
 * El ORDER BY usa el MISMO coalesce que el SELECT (el nombre efectivo, no `p.name`): si se
 * ordenara por una columna distinta de la exhibida, la paginación dejaría de corresponderse con
 * lo que el usuario ve. El desempate por `alegra_id` la hace determinística.
 *
 * El listado sale de `catalog_products`: una fila de overlay sin producto espejado no aparece
 * como producto y, sobre todo, no rompe el listado (REQ-OVL-03).
 */
export async function listarProductos(
  tenantId: string,
  filtros: FiltrosAdmin,
  opciones: { start?: number; limit?: number; orden?: OrdenListado } = {},
): Promise<{ items: ProductoAdmin[]; total: number }> {
  const start = Math.max(0, opciones.start ?? 0)
  const limit = Math.min(LIMITE_LISTADO_MAX, Math.max(1, opciones.limit ?? LIMITE_LISTADO_DEFAULT))
  const where = whereListado(tenantId, filtros)
  const nombre = nombreEfectivoSql(sql`o.nombre`, sql`p.description`, sql`p.name`, sql`p.code`)
  const orden =
    opciones.orden === "nombre-desc"
      ? sql`${nombre} DESC, p.alegra_id DESC`
      : opciones.orden === "actualizado"
        ? sql`o.updated_at DESC NULLS LAST, p.alegra_id ASC`
        : sql`${nombre} ASC, p.alegra_id ASC`

  const db = getDb()
  const [filas, conteo] = await Promise.all([
    db.execute(sql`
      SELECT ${columnasListado} ${desdeListado}
      WHERE ${where}
      ORDER BY ${orden}
      LIMIT ${limit} OFFSET ${start}
    `),
    db.execute(sql`SELECT count(*)::int AS n ${desdeListado} WHERE ${where}`),
  ])

  return {
    items: (filas as unknown as FilaListadoCruda[]).map(aProductoAdmin),
    total: Number((conteo[0] as { n: number }).n),
  }
}

/** La ficha de un producto. null si ese `alegraId` no existe en el espejo de ESTE tenant. */
export async function detalleProducto(tenantId: string, alegraId: string): Promise<ProductoAdmin | null> {
  const filas = await getDb().execute(sql`
    SELECT ${columnasListado} ${desdeListado}
    WHERE p.tenant_id = ${tenantId} AND p.alegra_id = ${alegraId}
    LIMIT 1
  `)
  const fila = (filas as unknown as FilaListadoCruda[])[0]
  return fila ? aProductoAdmin(fila) : null
}

// ─── Frescura del aviso al Shop (decisión D1) ────────────────────────────────────────────
//
// El CRM registra SU propio último aviso entregado, no la sincronización del Shop: preguntarle
// al Shop metería una dependencia Shop→CRM en el panel, que es exactamente el acoplamiento que
// toda esta arquitectura existe para evitar. La UI lo rotula por lo que es ("Último aviso
// entregado a la tienda") y dice "Desconocida" cuando no hay ninguno, nunca una fecha inventada.

export interface AvisoShop {
  ultimoOkAt: string | null
  ultimoIntentoAt: string | null
}

export async function registrarAvisoShop(tenantId: string, propagado: boolean): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO ${shopSyncPing} (tenant_id, ultimo_ok_at, ultimo_intento_at)
    VALUES (${tenantId}, ${propagado ? sql`now()` : sql`null`}, now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      ultimo_ok_at = ${propagado ? sql`now()` : sql`${shopSyncPing}.ultimo_ok_at`},
      ultimo_intento_at = now()
  `)
}

export async function leerAvisoShop(tenantId: string): Promise<AvisoShop> {
  const [row] = await getDb()
    .select({ ultimoOkAt: shopSyncPing.ultimoOkAt, ultimoIntentoAt: shopSyncPing.ultimoIntentoAt })
    .from(shopSyncPing)
    .where(eq(shopSyncPing.tenantId, tenantId))
  return {
    ultimoOkAt: row?.ultimoOkAt ? row.ultimoOkAt.toISOString() : null,
    ultimoIntentoAt: row?.ultimoIntentoAt ? row.ultimoIntentoAt.toISOString() : null,
  }
}

/** La última corrida OK de la sync de Alegra (el otro lado del indicador de frescura). */
export async function ultimaSyncAlegra(tenantId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ finishedAt: catalogSyncLog.finishedAt })
    .from(catalogSyncLog)
    .where(and(eq(catalogSyncLog.tenantId, tenantId), eq(catalogSyncLog.status, "ok")))
    .orderBy(desc(catalogSyncLog.startedAt))
    .limit(1)
  return row?.finishedAt ? row.finishedAt.toISOString() : null
}

// ─── Importación de categorías desde Alegra ──────────────────────────────────────────────

export interface ResultadoImportacion {
  /** Categorías propias creadas en esta corrida. */
  creadas: number
  /** Categorías de Alegra que ya se habían importado antes y se saltearon. */
  existentes: number
  /** Productos que quedaron clasificados por primera vez. */
  clasificados: number
}

/**
 * Crea una categoría propia por cada categoría ACTIVA de Alegra y clasifica con ella a los
 * productos que la tengan.
 *
 * Existe porque la taxonomía propia arranca vacía y clasificar miles de productos a mano es el
 * verdadero costo de este cambio: si Alegra ya sabe la categoría de una parte del catálogo,
 * conviene partir de ahí y subdividir después, en vez de arrancar de cero.
 *
 * Dos reglas que la hacen segura de correr más de una vez:
 *  - Se saltea toda categoría de Alegra ya importada (`origen_alegra_id`), así que no duplica.
 *  - **Nunca pisa una clasificación existente**: sólo toca productos cuyo overlay no tiene
 *    categoría. El trabajo manual siempre gana sobre lo que dice Alegra.
 *
 * Todo en UNA transacción: o queda el árbol con sus productos clasificados, o no queda nada.
 */
export async function importarCategoriasDeAlegra(
  tenantId: string,
  actor: string | null,
): Promise<ResultadoImportacion> {
  const db = getDb()

  return db.transaction(async (tx) => {
    const deAlegra = await tx
      .select({ alegraId: catalogCategories.alegraId, name: catalogCategories.name })
      .from(catalogCategories)
      .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.status, "active")))
      .orderBy(asc(catalogCategories.name))

    const yaImportadas = await tx
      .select({ origen: shopCategories.origenAlegraId })
      .from(shopCategories)
      .where(and(eq(shopCategories.tenantId, tenantId), sql`${shopCategories.origenAlegraId} is not null`))
    const vistas = new Set(yaImportadas.map((r) => r.origen))

    let creadas = 0
    let clasificados = 0

    for (const [i, cat] of deAlegra.entries()) {
      if (vistas.has(cat.alegraId)) continue

      // La jerarquía de Alegra NO se replica: sus categorías entran como nivel 1 y el árbol se
      // subdivide después desde el panel. Importar una jerarquía que no se puede ordenar ni
      // renombrar sin desincronizarse sería heredar el problema que la taxonomía propia resuelve.
      const [row] = await tx
        .insert(shopCategories)
        .values({
          tenantId,
          nombre: cat.name,
          slug: slugUnico(slugify(cat.name), cat.alegraId),
          parentId: null,
          nivel: 1,
          orden: i,
          origenAlegraId: cat.alegraId,
        })
        .returning({ id: shopCategories.id })
      creadas++

      // Alta del overlay para los productos de esa categoría que todavía no tienen una propia.
      // `visible` NO se toca: clasificar no publica.
      const res = await tx.execute(sql`
        INSERT INTO catalog_overlay (tenant_id, alegra_id, categoria_id, updated_by, updated_at)
        SELECT p.tenant_id, p.alegra_id, ${row.id}, ${actor}, now()
        FROM catalog_products p
        WHERE p.tenant_id = ${tenantId}
          AND p.category_alegra_id = ${cat.alegraId}
        ON CONFLICT (tenant_id, alegra_id) DO UPDATE
          SET categoria_id = EXCLUDED.categoria_id,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
          WHERE catalog_overlay.categoria_id IS NULL
      `)
      clasificados += Number((res as unknown as { count?: number }).count ?? 0)
    }

    return { creadas, existentes: vistas.size, clasificados }
  })
}

/** Slug estable ante nombres repetidos en Alegra: le cuelga un sufijo del id de origen. */
function slugUnico(base: string, alegraId: string): string {
  return base ? `${base}-${alegraId}`.slice(0, 120) : `categoria-${alegraId}`
}
