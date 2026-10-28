import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { campaniaReglas, campanias, catalogProducts, preciosOnlineCambios, shopCategories } from "@/db/schema"
import { avisarShop } from "./aviso-shop"
import {
  claveAlcance,
  estadoCampania,
  type AlcanceRegla,
  type CampaniaEntrada,
  type EstadoCampania,
  type ReglaEntrada,
} from "./campanias-validar"
import { lockTenant, PreciosOnlineError, type Tx, type UsuarioActor } from "./precios-online-repo"

// Campañas de precios (spec 2026-10-28-campanias-precios-design.md). El cálculo y la
// materialización viven en SQL (0095: calcular_campanias_online / aplicar_campanias_online). Acá:
// alta, edición, terminar, eliminar, vista previa y lecturas para el admin. Todo bajo el mismo
// advisory lock que Precios online, con historial en precios_online_cambios (tipo 'campania').

export interface CampaniaDto {
  id: string
  nombre: string
  etiqueta: string
  inicio: string
  fin: string
  estado: EstadoCampania
  /** Productos que la campaña alcanza hoy (entradas materializadas). */
  productos: number
}

export interface ReglaDto extends ReglaEntrada {
  id: string
  /** Nombre del producto o de la categoría, para mostrar. */
  descripcion: string | null
}

export interface CampaniaDetalleDto extends CampaniaDto {
  reglas: ReglaDto[]
}

export interface FilaPreviaCampania {
  alegraId: string
  nombre: string
  costo: number | null
  precios: { lista: string; normal: number; campania: number }[]
}

export interface PreviaCampania {
  productos: number
  bajoCosto: number
  muestra: FilaPreviaCampania[]
  choque: { id: string; nombre: string } | null
}

const MSG_NO_EXISTE = "La campaña indicada no existe."
const MUESTRA = 20

const contiene = (id: string) => sql`${catalogProducts.campaniasOnline} @> jsonb_build_array(jsonb_build_object('id', ${id}::text))`

async function ahoraTx(tx: Tx): Promise<Date> {
  const [r] = (await tx.execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  return new Date(r.n)
}

async function choqueDe(
  tx: Tx,
  tenantId: string,
  inicio: string,
  fin: string,
  exceptoId?: string,
): Promise<{ id: string; nombre: string } | null> {
  const [c] = await tx
    .select({ id: campanias.id, nombre: campanias.nombre })
    .from(campanias)
    .where(
      and(
        eq(campanias.tenantId, tenantId),
        exceptoId ? ne(campanias.id, exceptoId) : undefined,
        sql`tstzrange(${campanias.inicio}, ${campanias.fin}) && tstzrange(${inicio}::timestamptz, ${fin}::timestamptz)`,
      ),
    )
    .orderBy(asc(campanias.inicio))
    .limit(1)
  return c ?? null
}

function filaRegla(tenantId: string, campaniaId: string, r: ReglaEntrada) {
  const a = r.alcance
  return {
    tenantId,
    campaniaId,
    tipo: a.tipo,
    alegraId: a.tipo === "producto" ? a.alegraId : null,
    marca: a.tipo === "marca" ? a.marca : null,
    categoriaId: a.tipo === "categoria" ? a.categoriaId : null,
    pct: r.pct,
    unidades: a.tipo === "producto" ? (r.unidades ?? null) : null,
  }
}

function alcanceDeFila(r: typeof campaniaReglas.$inferSelect): AlcanceRegla {
  if (r.tipo === "producto") return { tipo: "producto", alegraId: r.alegraId! }
  if (r.tipo === "marca") return { tipo: "marca", marca: r.marca! }
  return { tipo: "categoria", categoriaId: r.categoriaId! }
}

/**
 * Sincroniza las reglas CONSERVANDO el id de las que siguen (upsert por objetivo): el Shop cuenta las
 * unidades vendidas por `campania_regla_id`; si una edición cambiara los ids, el contador volvería a 0.
 */
async function sincronizarReglas(tx: Tx, tenantId: string, campaniaId: string, reglas: ReglaEntrada[]): Promise<void> {
  const actuales = await tx
    .select()
    .from(campaniaReglas)
    .where(and(eq(campaniaReglas.tenantId, tenantId), eq(campaniaReglas.campaniaId, campaniaId)))
  const porClave = new Map(actuales.map((r) => [claveAlcance(alcanceDeFila(r)), r]))
  const quedan = new Set<string>()
  for (const r of reglas) {
    const existente = porClave.get(claveAlcance(r.alcance))
    if (existente) {
      quedan.add(existente.id)
      await tx
        .update(campaniaReglas)
        .set({ pct: r.pct, unidades: r.alcance.tipo === "producto" ? (r.unidades ?? null) : null, updatedAt: sql`now()` })
        .where(eq(campaniaReglas.id, existente.id))
    } else {
      await tx.insert(campaniaReglas).values(filaRegla(tenantId, campaniaId, r))
    }
  }
  const borrar = actuales.filter((r) => !quedan.has(r.id)).map((r) => r.id)
  if (borrar.length) await tx.delete(campaniaReglas).where(inArray(campaniaReglas.id, borrar))
}

/**
 * Las categorías de las reglas tienen que ser del tenant: la FK a shop_categories no mira el tenant
 * y sola no alcanza (mismo criterio que `categoriaPropia` del overlay).
 */
async function validarCategorias(tx: Tx, tenantId: string, reglas: ReglaEntrada[]): Promise<void> {
  const ids = [...new Set(reglas.flatMap((r) => (r.alcance.tipo === "categoria" ? [r.alcance.categoriaId] : [])))]
  if (ids.length === 0) return
  const propias = await tx
    .select({ id: shopCategories.id })
    .from(shopCategories)
    .where(and(eq(shopCategories.tenantId, tenantId), inArray(shopCategories.id, ids)))
  if (propias.length !== ids.length) {
    throw new PreciosOnlineError(422, "categoria_invalida", "Seleccione una categoría válida.")
  }
}

async function cargar(tx: Tx, tenantId: string, id: string) {
  const [c] = await tx
    .select()
    .from(campanias)
    .where(and(eq(campanias.tenantId, tenantId), eq(campanias.id, id)))
    .for("update")
  if (!c) throw new PreciosOnlineError(404, "campania_no_existe", MSG_NO_EXISTE)
  return c
}

async function registrar(
  tx: Tx,
  tenantId: string,
  actor: UsuarioActor,
  id: string,
  operacion: "alta" | "edicion" | "terminada" | "baja",
  antes: Record<string, unknown> | null,
  despues: Record<string, unknown> | null,
  nombre: string,
): Promise<void> {
  const [{ n }] = (await tx.execute(
    sql`SELECT count(*)::int AS n FROM catalog_products WHERE tenant_id = ${tenantId} AND ${contiene(id)}`,
  )) as unknown as { n: number }[]
  await tx.insert(preciosOnlineCambios).values({
    tenantId,
    tipo: "campania",
    objeto: `campania:${id}`,
    antes,
    despues,
    resumen: { operacion, campania: nombre, productosAfectados: Number(n) },
    usuario: actor.email || actor.id,
    creadoAt: sql`clock_timestamp()`,
  })
}

async function snapshot(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const [c] = await tx.select().from(campanias).where(eq(campanias.id, id))
  const reglas = await tx.select().from(campaniaReglas).where(eq(campaniaReglas.campaniaId, id))
  return {
    nombre: c.nombre,
    etiqueta: c.etiqueta,
    inicio: c.inicio.toISOString(),
    fin: c.fin.toISOString(),
    reglas: reglas.map((r) => ({ id: r.id, alcance: alcanceDeFila(r), pct: r.pct, unidades: r.unidades })),
  }
}

async function aplicarYAvisar<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const r = await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const out = await fn(tx)
    await tx.execute(sql`SELECT aplicar_campanias_online(${tenantId}, NULL::text[])`)
    return out
  })
  try {
    await avisarShop(tenantId)
  } catch (err) {
    console.warn(`[campanias] aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
  }
  return r
}

/** Alta (sin `id`) o edición. `e` ya pasó por `validarCampania`. */
export async function guardarCampania(
  tenantId: string,
  e: CampaniaEntrada,
  actor: UsuarioActor,
  id?: string,
): Promise<{ id: string }> {
  return aplicarYAvisar(tenantId, async (tx) => {
    const ahora = await ahoraTx(tx)
    const inicio = new Date(e.inicio)
    const fin = new Date(e.fin)
    let antes: Record<string, unknown> | null = null
    if (id) {
      const actual = await cargar(tx, tenantId, id)
      const estado = estadoCampania(actual, ahora)
      if (estado === "terminada") {
        throw new PreciosOnlineError(409, "campania_terminada", "Una campaña terminada no se puede editar.")
      }
      if (estado === "activa" && inicio.getTime() !== actual.inicio.getTime()) {
        throw new PreciosOnlineError(409, "campania_activa", "La campaña ya empezó: no se puede cambiar su inicio.")
      }
      antes = await snapshot(tx, id)
    }
    await validarCategorias(tx, tenantId, e.reglas)
    if (fin.getTime() <= ahora.getTime()) {
      throw new PreciosOnlineError(422, "fin_pasado", "La fecha de fin debe ser posterior al momento actual.")
    }
    const choque = await choqueDe(tx, tenantId, e.inicio, e.fin, id)
    if (choque) {
      throw new PreciosOnlineError(409, "campania_superpuesta", `Las fechas se superponen con la campaña "${choque.nombre}".`, {
        choque,
      })
    }
    const valores = { nombre: e.nombre, etiqueta: e.etiqueta || e.nombre, inicio, fin }
    let campaniaId = id
    if (campaniaId) {
      await tx.update(campanias).set({ ...valores, updatedAt: sql`now()` }).where(eq(campanias.id, campaniaId))
    } else {
      const [nueva] = await tx
        .insert(campanias)
        .values({ tenantId, ...valores, creadoPor: actor.email || actor.id })
        .returning({ id: campanias.id })
      campaniaId = nueva.id
    }
    await sincronizarReglas(tx, tenantId, campaniaId, e.reglas)
    await tx.execute(sql`SELECT aplicar_campanias_online(${tenantId}, NULL::text[])`)
    await registrar(tx, tenantId, actor, campaniaId, id ? "edicion" : "alta", antes, await snapshot(tx, campaniaId), e.nombre)
    return { id: campaniaId }
  })
}

/** Terminar ahora: sólo una activa; fin = now(). Los productos conservan la entrada 24 h (gracia). */
export async function terminarCampania(tenantId: string, id: string, actor: UsuarioActor): Promise<void> {
  await aplicarYAvisar(tenantId, async (tx) => {
    const actual = await cargar(tx, tenantId, id)
    if (estadoCampania(actual, await ahoraTx(tx)) !== "activa") {
      throw new PreciosOnlineError(409, "campania_no_activa", "Sólo se puede terminar una campaña activa.")
    }
    const antes = await snapshot(tx, id)
    await tx.update(campanias).set({ fin: sql`now()`, updatedAt: sql`now()` }).where(eq(campanias.id, id))
    await registrar(tx, tenantId, actor, id, "terminada", antes, await snapshot(tx, id), actual.nombre)
  })
}

/** Eliminar: sólo una programada (una que ya empezó queda en el historial de pedidos). */
export async function eliminarCampania(tenantId: string, id: string, actor: UsuarioActor): Promise<void> {
  await aplicarYAvisar(tenantId, async (tx) => {
    const actual = await cargar(tx, tenantId, id)
    if (estadoCampania(actual, await ahoraTx(tx)) !== "programada") {
      throw new PreciosOnlineError(409, "campania_empezada", "Sólo se puede eliminar una campaña que todavía no empezó.")
    }
    const antes = await snapshot(tx, id)
    await registrar(tx, tenantId, actor, id, "baja", antes, null, actual.nombre)
    await tx.delete(campanias).where(eq(campanias.id, id))
  })
}

const ROLLBACK = new Error("rollback de la vista previa")

/**
 * Vista previa: aplica la campaña en una transacción que SIEMPRE se revierte y mide qué productos
 * alcanza, cuántos quedan por debajo del costo y una muestra de normal → campaña por lista.
 */
export async function previsualizarCampania(
  tenantId: string,
  e: CampaniaEntrada,
  exceptoId?: string,
): Promise<PreviaCampania> {
  let previa: PreviaCampania | null = null
  try {
    await getDb().transaction(async (tx) => {
      await lockTenant(tx, tenantId)
      if (exceptoId) await cargar(tx, tenantId, exceptoId) // 404 si no es del tenant
      await validarCategorias(tx, tenantId, e.reglas)
      const choque = await choqueDe(tx, tenantId, e.inicio, e.fin, exceptoId)
      // La previa no se cruza con el choque: se mide en una campaña temporal sin otras alrededor.
      let campaniaId = exceptoId
      const valores = { nombre: e.nombre, etiqueta: e.etiqueta || e.nombre, inicio: new Date(e.inicio), fin: new Date(e.fin) }
      if (campaniaId) {
        await tx.update(campanias).set(valores).where(and(eq(campanias.tenantId, tenantId), eq(campanias.id, campaniaId)))
      } else {
        const [n] = await tx.insert(campanias).values({ tenantId, ...valores }).returning({ id: campanias.id })
        campaniaId = n.id
      }
      await sincronizarReglas(tx, tenantId, campaniaId, e.reglas)
      await tx.execute(sql`SELECT aplicar_campanias_online(${tenantId}, NULL::text[])`)

      const [{ productos, bajo }] = (await tx.execute(sql`
        SELECT count(*)::int AS productos,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM jsonb_array_elements(e->'precios') x
                 WHERE (x->>'price')::numeric < p.costo_aplicado
               ))::int AS bajo
        FROM catalog_products p
        CROSS JOIN LATERAL jsonb_array_elements(p.campanias_online) e
        WHERE p.tenant_id = ${tenantId} AND e->>'id' = ${campaniaId}
      `)) as unknown as { productos: number; bajo: number }[]

      const filas = await tx
        .select({
          alegraId: catalogProducts.alegraId,
          nombre: catalogProducts.name,
          costo: catalogProducts.costoAplicado,
          normal: catalogProducts.preciosOnline,
          campanias: catalogProducts.campaniasOnline,
        })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), contiene(campaniaId)))
        .orderBy(asc(catalogProducts.name))
        .limit(MUESTRA)

      const muestra = filas.map((f) => {
        const normal = (f.normal as { idPriceList: string; name: string; price: number }[]) ?? []
        const entrada = ((f.campanias as { id: string; precios: { idPriceList: string; price: number }[] }[]) ?? []).find(
          (x) => x.id === campaniaId,
        )
        return {
          alegraId: f.alegraId,
          nombre: f.nombre,
          costo: f.costo == null ? null : Number(f.costo),
          precios: normal.map((l) => ({
            lista: l.name,
            normal: Number(l.price),
            campania: Number(entrada?.precios.find((x) => x.idPriceList === l.idPriceList)?.price ?? l.price),
          })),
        }
      })
      previa = { productos: Number(productos), bajoCosto: Number(bajo), muestra, choque }
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
  if (!previa) throw new Error("previsualizarCampania: sin resultado")
  return previa
}

// ── Lecturas para el admin ──────────────────────────────────────────────────────────────────

export async function listarCampanias(tenantId: string): Promise<CampaniaDto[]> {
  const db = getDb()
  const [{ n }] = (await db.execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  const ahora = new Date(n)
  const filas = await db
    .select({
      id: campanias.id,
      nombre: campanias.nombre,
      etiqueta: campanias.etiqueta,
      inicio: campanias.inicio,
      fin: campanias.fin,
      productos: sql<number>`(SELECT count(*)::int FROM catalog_products p
        WHERE p.tenant_id = ${tenantId}
          AND p.campanias_online @> jsonb_build_array(jsonb_build_object('id', "campanias"."id"::text)))`,
    })
    .from(campanias)
    .where(eq(campanias.tenantId, tenantId))
    .orderBy(sql`${campanias.inicio} desc`)
  return filas.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    etiqueta: c.etiqueta,
    inicio: c.inicio.toISOString(),
    fin: c.fin.toISOString(),
    estado: estadoCampania(c, ahora),
    productos: Number(c.productos),
  }))
}

export async function leerCampania(tenantId: string, id: string): Promise<CampaniaDetalleDto | null> {
  const lista = await listarCampanias(tenantId)
  const c = lista.find((x) => x.id === id)
  if (!c) return null
  const reglas = await getDb()
    .select({
      regla: campaniaReglas,
      producto: catalogProducts.name,
      categoria: shopCategories.nombre,
    })
    .from(campaniaReglas)
    .leftJoin(
      catalogProducts,
      and(eq(catalogProducts.tenantId, campaniaReglas.tenantId), eq(catalogProducts.alegraId, campaniaReglas.alegraId)),
    )
    .leftJoin(
      shopCategories,
      and(eq(shopCategories.tenantId, campaniaReglas.tenantId), eq(shopCategories.id, campaniaReglas.categoriaId)),
    )
    .where(and(eq(campaniaReglas.tenantId, tenantId), eq(campaniaReglas.campaniaId, id)))
    .orderBy(asc(campaniaReglas.tipo), asc(campaniaReglas.createdAt))
  return {
    ...c,
    reglas: reglas.map(({ regla, producto, categoria }) => ({
      id: regla.id,
      alcance: alcanceDeFila(regla),
      pct: regla.pct,
      unidades: regla.unidades,
      descripcion: regla.tipo === "producto" ? producto : regla.tipo === "categoria" ? categoria : regla.marca,
    })),
  }
}
