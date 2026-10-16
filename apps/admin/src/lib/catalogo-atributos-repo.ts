import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogAtributosLegacy } from "@/db/schema"
import {
  CLAVES_ATRIBUTO,
  extraerAtributosDeNombre,
  type AtributoExtraido,
  type ClaveAtributo,
} from "./catalogo-atributos-extraccion"
import {
  modoAtributosDe,
  escribirFilasPlataforma,
  escribirProductosPlataforma,
  escribirAtributosPlataformaDetalle,
  datosDeFilas,
  type Valor,
} from "@/lib/plataforma-atributos"
import type { InstanciaPlataforma } from "@/lib/plataforma-cliente"
import { mensajeRechazoPlataforma } from "@/lib/plataforma-rechazo"
import { getTenantByIdFromDb, type ModoPlataformaAtributos, type TenantConfig } from "@/lib/tenants"

// Escritura y lectura de los atributos técnicos (migración 0049; corte 0091). La tabla local es
// `catalog_atributos_legacy` (hasta 0091 se llamaba `catalog_atributos`, que ahora es una vista
// sobre la proyección de la plataforma).
//
// PRECEDENCIA: manual > pdf > nombre. Una escritura NUNCA pisa una fila de mayor precedencia, y la
// regla vive en el SQL del upsert (ON CONFLICT … DO UPDATE … WHERE), no sólo en TS: dos escrituras
// concurrentes (la sync y el panel) no pueden saltearla. Misma precedencia ⇒ se pisa (idempotente:
// correr dos veces el backfill da lo mismo). Si el valor no cambió no se toca la fila (no mueve
// `updated_at` en cada sync diaria).
//
// Filas `nombre` que dejaron de salir del nombre (renombraron el producto en Alegra): se BORRAN en
// `reemplazarAtributosDeNombre`. Nunca se borra una fila `pdf` o `manual` desde la sync.
//
// MODOS (tenants.plataforma_atributos): `off` escribe sólo acá; `dual` escribe acá y espeja en la
// plataforma; `on` escribe sólo en la plataforma (la tabla local queda congelada desde el corte).
// La escritura a la plataforma va DESPUÉS de la local y nunca tira: un fallo se loguea y no tumba
// ni la local ni la sync. Excepción: el panel manual en `on` (`guardarAtributosManual`), donde la
// plataforma es la única escritura y su rechazo o caída llega al operador como error.
//
// LECTURA (`leerFilasAtributos` y lo que se arma encima): en `off`/`dual` la tabla local (la viva
// en esos modos); en `on` la proyección de la plataforma (`catalog_atributos_shop`, lo mismo que
// lee el Shop) con la fuente de `catalog_proyeccion.data->'fuentes'`.

export type FuenteAtributo = "nombre" | "pdf" | "manual"

export const RANGO_FUENTE: Record<FuenteAtributo, number> = { nombre: 1, pdf: 2, manual: 3 }

/** ¿Una escritura de `nueva` puede reemplazar una fila guardada con `guardada`? */
export function puedePisar(nueva: FuenteAtributo, guardada: FuenteAtributo): boolean {
  return RANGO_FUENTE[nueva] >= RANGO_FUENTE[guardada]
}

const LOTE = 500

/** Rango SQL de una columna `fuente` (espejo de RANGO_FUENTE). */
const rango = (col: string) =>
  sql.raw(`(CASE ${col} WHEN 'manual' THEN 3 WHEN 'pdf' THEN 2 ELSE 1 END)`)

/** SET WHERE del upsert: precedencia y "algo cambió". */
const SET_WHERE = sql`${rango(`excluded."fuente"`)} >= ${rango(`"catalog_atributos_legacy"."fuente"`)} AND (
  "catalog_atributos_legacy"."valor_num" IS DISTINCT FROM excluded."valor_num"
  OR "catalog_atributos_legacy"."valor_texto" IS DISTINCT FROM excluded."valor_texto"
  OR "catalog_atributos_legacy"."fuente" IS DISTINCT FROM excluded."fuente"
)`

export interface FilaAtributo extends AtributoExtraido {
  alegraId: string
}

/** Tenant para escribir en la plataforma, o null (y se loguea) si no se pudo leer. Nunca tira. */
async function tenantPlataforma(tenantId: string): Promise<TenantConfig | null> {
  try {
    return await getTenantByIdFromDb(tenantId)
  } catch (err) {
    console.warn(`[plataforma] no se pudo leer el tenant=${tenantId}: ${err instanceof Error ? err.message : "error"}`)
    return null
  }
}

/** Una sola fila por (producto, clave) por INSERT: Postgres no deja tocar dos veces la misma. */
function filasUnicas(filas: FilaAtributo[]): FilaAtributo[] {
  return [...new Map(filas.map((f) => [`${f.alegraId}|${f.clave}`, f])).values()].filter(
    (f) => f.valorNum != null || f.valorTexto != null,
  )
}

/**
 * Upsert con precedencia. Devuelve cuántas filas quedaron escritas (insertadas o actualizadas);
 * las que una fuente de mayor precedencia protegía no cuentan. En `on` devuelve las filas que la
 * plataforma aceptó.
 */
export async function upsertAtributos(tenantId: string, filas: FilaAtributo[], fuente: FuenteAtributo): Promise<number> {
  const modo = await modoAtributosDe(tenantId)
  let escritas = 0
  if (modo !== "on") escritas = await upsertLocal(tenantId, filas, fuente)
  if (modo !== "off") {
    try {
      const t = await tenantPlataforma(tenantId)
      if (t) {
        const r = await escribirFilasPlataforma(t, filasUnicas(filas), fuente)
        if (modo === "on") escritas = r.filasOk
      }
    } catch (err) {
      console.warn(`[plataforma] atributos tenant=${tenantId}: ${err instanceof Error ? err.message : "error"}`)
    }
  }
  return escritas
}

async function upsertLocal(tenantId: string, filas: FilaAtributo[], fuente: FuenteAtributo): Promise<number> {
  const unicas = filasUnicas(filas)
  let escritas = 0
  for (let i = 0; i < unicas.length; i += LOTE) {
    const res = await getDb()
      .insert(catalogAtributosLegacy)
      .values(
        unicas.slice(i, i + LOTE).map((f) => ({
          tenantId,
          alegraId: f.alegraId,
          clave: f.clave,
          valorNum: f.valorNum != null ? String(f.valorNum) : null,
          valorTexto: f.valorTexto,
          fuente,
          updatedAt: sql`now()`,
        })),
      )
      .onConflictDoUpdate({
        target: [catalogAtributosLegacy.tenantId, catalogAtributosLegacy.alegraId, catalogAtributosLegacy.clave],
        set: {
          valorNum: sql`excluded.valor_num`,
          valorTexto: sql`excluded.valor_texto`,
          fuente: sql`excluded.fuente`,
          updatedAt: sql`now()`,
        },
        setWhere: SET_WHERE,
      })
      .returning({ clave: catalogAtributosLegacy.clave })
    escritas += res.length
  }
  return escritas
}

/** Cuántas filas hay por cada una de las claves del catálogo (las que no aparecen cuentan 0). */
export function contarPorClave(filas: readonly { clave: string }[]): Record<ClaveAtributo, number> {
  const out = Object.fromEntries(CLAVES_ATRIBUTO.map((c) => [c, 0])) as Record<ClaveAtributo, number>
  for (const f of filas) if (f.clave in out) out[f.clave as ClaveAtributo] += 1
  return out
}

export interface ProductoParaExtraer {
  alegraId: string
  name: string
  description: string | null
}

/** Filas `nombre` de un lote de productos (puro). */
export function filasDeNombre(productos: readonly ProductoParaExtraer[]): FilaAtributo[] {
  return productos.flatMap((p) =>
    extraerAtributosDeNombre(p.name, p.description).map((a) => ({ alegraId: p.alegraId, ...a })),
  )
}

/**
 * Lo que dice el NOMBRE de estos productos pasa a los atributos (fuente `nombre`), y las
 * filas `nombre` que ya no salen del nombre se borran. Las `pdf`/`manual` no se tocan. Idempotente.
 */
export async function reemplazarAtributosDeNombre(
  tenantId: string,
  productos: readonly ProductoParaExtraer[],
): Promise<{ escritas: number; borradas: number }> {
  const unicos = [...new Map(productos.map((p) => [p.alegraId, p])).values()]
  const modo = await modoAtributosDe(tenantId)
  const t = modo !== "off" ? await tenantPlataforma(tenantId) : null
  let escritas = 0
  let borradas = 0
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE)
    const filas = filasDeNombre(lote)
    if (modo !== "on") {
      escritas += await upsertLocal(tenantId, filas, "nombre")
      const conservar = filas.map((f) => `${f.alegraId}|${f.clave}`)
      const ids = lote.map((p) => p.alegraId)
      const res = await getDb()
        .delete(catalogAtributosLegacy)
        .where(
          and(
            eq(catalogAtributosLegacy.tenantId, tenantId),
            eq(catalogAtributosLegacy.fuente, "nombre"),
            inArray(catalogAtributosLegacy.alegraId, ids),
            conservar.length
              ? sql`(${catalogAtributosLegacy.alegraId} || '|' || ${catalogAtributosLegacy.clave}) NOT IN (${sql.join(
                  conservar.map((c) => sql`${c}`),
                  sql`, `,
                )})`
              : undefined,
          ),
        )
        .returning({ clave: catalogAtributosLegacy.clave })
      borradas += res.length
    }
    if (t) {
      try {
        // Un producto sin filas de nombre igual viaja con data {} para que la plataforma borre sus claves viejas.
        const porId = new Map<string, FilaAtributo[]>()
        for (const f of filas) porId.set(f.alegraId, [...(porId.get(f.alegraId) ?? []), f])
        const items = lote.map((p) => ({ alegraId: p.alegraId, data: datosDeFilas(porId.get(p.alegraId) ?? []) }))
        const r = await escribirProductosPlataforma(t, items, "nombre", { reemplaza: true })
        if (modo === "on") escritas += r.filasOk
      } catch (err) {
        console.warn(`[plataforma] atributos de nombre tenant=${tenantId}: ${err instanceof Error ? err.message : "error"}`)
      }
    }
  }
  return { escritas, borradas }
}

export interface AtributoGuardado extends AtributoExtraido {
  fuente: FuenteAtributo
  updatedAt: string
}

/** Una fila actual de atributos, venga de la tabla local o de la proyección. */
export interface FilaAtributoActual {
  alegraId: string
  clave: string
  valorNum: number | null
  valorTexto: string | null
  fuente: FuenteAtributo
  updatedAt: Date
}

const FUENTES: readonly FuenteAtributo[] = ["nombre", "pdf", "manual"]

/** La plataforma siempre mantiene `fuentes`; si faltara o fuera desconocida se toma la de menor precedencia. */
const fuenteValida = (f: unknown): FuenteAtributo => (FUENTES.includes(f as FuenteAtributo) ? (f as FuenteAtributo) : "nombre")

/**
 * Subconsulta con las filas ACTUALES de atributos de todos los tenants, con las columnas
 * (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente, updated_at), según el modo:
 * `off`/`dual` → la tabla local; `on` → la proyección (los valores de `catalog_atributos_shop`, la
 * misma vista que lee el Shop, y la fuente de `data->'fuentes'`). En `on`, `updated_at` es el de la
 * instancia (la plataforma no lo lleva por clave). Para usar como `FROM ${origenAtributosSql(modo)} a`.
 */
export function origenAtributosSql(modo: ModoPlataformaAtributos): SQL {
  if (modo !== "on") {
    return sql`(SELECT tenant_id, alegra_id, clave, valor_num, valor_texto, fuente, updated_at FROM "catalog_atributos_legacy")`
  }
  return sql`(SELECT v.tenant_id, v.alegra_id, v.clave, v.valor_num, v.valor_texto, p.data->'fuentes'->>v.clave AS fuente, p.updated_at
    FROM "catalog_atributos_shop" v
    JOIN "catalog_proyeccion" p ON p.tenant_id = v.tenant_id AND p.spec = 'atributos_tecnicos' AND p.external_key = v.alegra_id)`
}

/** Filas actuales de un tenant (todas, o las de `alegraIds`; una lista vacía no trae nada). */
export async function leerFilasAtributos(tenantId: string, alegraIds?: readonly string[]): Promise<FilaAtributoActual[]> {
  if (alegraIds && alegraIds.length === 0) return []
  const origen = origenAtributosSql(await modoAtributosDe(tenantId))
  const lotes = alegraIds ? Array.from({ length: Math.ceil(alegraIds.length / LOTE) }, (_, i) => alegraIds.slice(i * LOTE, (i + 1) * LOTE)) : [null]
  const out: FilaAtributoActual[] = []
  for (const ids of lotes) {
    const filas = (await getDb().execute(sql`
      SELECT a.alegra_id, a.clave, a.valor_num::text AS valor_num, a.valor_texto, a.fuente, a.updated_at
      FROM ${origen} a
      WHERE a.tenant_id = ${tenantId} ${ids ? sql`AND a.alegra_id IN ${ids}` : sql``}
      ORDER BY a.alegra_id, a.clave`)) as unknown as Record<string, unknown>[]
    for (const f of filas) {
      out.push({
        alegraId: String(f.alegra_id),
        clave: String(f.clave),
        valorNum: f.valor_num != null ? Number(f.valor_num) : null,
        valorTexto: (f.valor_texto as string | null) ?? null,
        fuente: fuenteValida(f.fuente),
        updatedAt: new Date(f.updated_at as string | Date),
      })
    }
  }
  return out
}

/** Orden de las claves del catálogo; las que no conoce (claves nuevas de la spec) van al final. */
function ordenarPorClave<T extends { clave: string }>(filas: T[]): T[] {
  const orden = (c: string) => {
    const i = CLAVES_ATRIBUTO.indexOf(c as ClaveAtributo)
    return i < 0 ? CLAVES_ATRIBUTO.length : i
  }
  return filas.sort((a, b) => orden(a.clave) - orden(b.clave) || a.clave.localeCompare(b.clave))
}

/** Atributos de un producto, en el orden de las claves. */
export async function leerAtributos(tenantId: string, alegraId: string): Promise<AtributoGuardado[]> {
  const filas = await leerFilasAtributos(tenantId, [alegraId])
  return ordenarPorClave(
    filas.map((f) => ({
      clave: f.clave as ClaveAtributo,
      valorNum: f.valorNum,
      valorTexto: f.valorTexto,
      fuente: f.fuente,
      updatedAt: f.updatedAt.toISOString(),
    })),
  )
}

/** Filas actuales de varios productos, por clave `alegraId|clave` (para el dry-run del aplicador de PDF). */
export async function leerAtributosDeProductos(
  tenantId: string,
  alegraIds: string[],
): Promise<Map<string, { fuente: FuenteAtributo; valorNum: number | null; valorTexto: string | null }>> {
  const out = new Map<string, { fuente: FuenteAtributo; valorNum: number | null; valorTexto: string | null }>()
  for (const f of await leerFilasAtributos(tenantId, alegraIds)) {
    out.set(`${f.alegraId}|${f.clave}`, { fuente: f.fuente, valorNum: f.valorNum, valorTexto: f.valorTexto })
  }
  return out
}

/** Error del guardado manual que se le muestra al operador (`paraUsuario`, en usted) con su estado HTTP. */
export class ErrorGuardadoAtributos extends Error {
  constructor(
    message: string,
    readonly paraUsuario: string,
    readonly estado: number,
  ) {
    super(message)
    this.name = "ErrorGuardadoAtributos"
  }
}

const NO_SE_PUDO_GUARDAR = "No se pudo guardar en la plataforma. Inténtelo de nuevo."

/** Atributos de la instancia que devolvió la plataforma (sin `fuentes`, sin valores vacíos). */
function atributosDeInstancia(inst: InstanciaPlataforma): AtributoGuardado[] {
  const fuentes = (inst.data.fuentes ?? {}) as Record<string, unknown>
  const updatedAt = inst.updatedAt ?? new Date().toISOString()
  const out: AtributoGuardado[] = []
  for (const [clave, v] of Object.entries(inst.data)) {
    if (clave === "fuentes" || typeof v !== "object" || v === null) continue
    const { n, t } = v as { n?: unknown; t?: unknown }
    const valorNum = typeof n === "number" && Number.isFinite(n) ? n : null
    const valorTexto = typeof t === "string" ? t : null
    if (valorNum == null && valorTexto == null) continue
    out.push({ clave: clave as ClaveAtributo, valorNum, valorTexto, fuente: fuenteValida(fuentes[clave]), updatedAt })
  }
  return ordenarPorClave(out)
}

/**
 * Escritura de un producto en la plataforma cuando es la ÚNICA escritura (modo `on`, panel manual y
 * lectura de ficha): un rechazo tira 422 con el motivo legible, una caída 502 y un tenant ilegible
 * 503, todos `ErrorGuardadoAtributos`. Devuelve la instancia escrita si la respuesta la trae.
 */
async function escribirEnPlataforma(
  tenantId: string,
  alegraId: string,
  data: Record<string, Valor | null>,
  fuente: FuenteAtributo,
): Promise<InstanciaPlataforma | null> {
  const t = await tenantPlataforma(tenantId)
  if (!t) throw new ErrorGuardadoAtributos(`tenant=${tenantId} ilegible`, NO_SE_PUDO_GUARDAR, 503)
  const r = await escribirAtributosPlataformaDetalle(t, alegraId, data, fuente)
  if (r.estado === "rechazado") {
    throw new ErrorGuardadoAtributos(`plataforma rechazó ${r.code}: ${r.detalles.join("; ")}`, mensajeRechazoPlataforma(r.code, r.detalles), 422)
  }
  if (r.estado === "error") throw new ErrorGuardadoAtributos("plataforma no disponible", NO_SE_PUDO_GUARDAR, 502)
  return r.instancia
}

const mismoValor = (a: { valorNum: number | null; valorTexto: string | null }, b: { valorNum: number | null; valorTexto: string | null }) =>
  a.valorNum === b.valorNum && a.valorTexto === b.valorTexto

/**
 * Lo leído de la ficha PDF de UN producto queda con fuente `pdf` (no pisa lo `manual`). Devuelve los
 * atributos del producto tras guardar y cuántos de los leídos se escribieron.
 *
 * `off`/`dual`: como siempre (`upsertAtributos` y se relee la tabla local; un fallo de la
 * plataforma en `dual` no tira). `on`: la plataforma es la única escritura, así que un rechazo
 * (400 invalid_data rechaza TODO el producto) o una caída tiran `ErrorGuardadoAtributos` en vez de
 * pasar por "sin cambios" y perder la lectura paga. En el éxito los atributos salen de la instancia
 * devuelta (no de la proyección, que va detrás del webhook); un leído NO cuenta como escrito si la
 * instancia lo guarda con una fuente que le gana a `pdf`, o si la proyección ya lo tenía igual con
 * fuente `pdf` (la plataforma no informa cambios por clave).
 */
export async function guardarAtributosDeFicha(
  tenantId: string,
  alegraId: string,
  leidos: AtributoExtraido[],
): Promise<{ atributos: AtributoGuardado[]; escritas: number }> {
  const modo = await modoAtributosDe(tenantId)
  if (modo !== "on") {
    const escritas = await upsertAtributos(tenantId, leidos.map((a) => ({ alegraId, ...a })), "pdf")
    return { atributos: await leerAtributos(tenantId, alegraId), escritas }
  }
  const unicos = filasUnicas(leidos.map((a) => ({ alegraId, ...a })))
  const antes = await leerAtributos(tenantId, alegraId)
  if (!unicos.length) return { atributos: antes, escritas: 0 }
  const instancia = await escribirEnPlataforma(tenantId, alegraId, datosDeFilas(unicos), "pdf")
  const ahora = new Date().toISOString()
  const despues = instancia
    ? atributosDeInstancia(instancia)
    : // Sin instancia en la respuesta: lo leído sobre la proyección, salvo donde manda una fuente mayor.
      ordenarPorClave([
        ...antes.filter((a) => !unicos.some((u) => u.clave === a.clave && puedePisar("pdf", a.fuente))),
        ...unicos
          .filter((u) => !antes.some((a) => a.clave === u.clave && !puedePisar("pdf", a.fuente)))
          .map((u) => ({ clave: u.clave, valorNum: u.valorNum, valorTexto: u.valorTexto, fuente: "pdf" as const, updatedAt: ahora })),
      ])
  const escritas = unicos.filter((u) => {
    const guardado = despues.find((a) => a.clave === u.clave)
    if (!guardado || guardado.fuente !== "pdf" || !mismoValor(guardado, u)) return false
    const previo = antes.find((a) => a.clave === u.clave)
    return !(previo && previo.fuente === "pdf" && mismoValor(previo, u))
  }).length
  return { atributos: despues, escritas }
}

/**
 * Panel manual: los valores dados quedan `manual` (le ganan a todo) y las claves de `quitar` se
 * borran (de cualquier fuente: "este dato está mal"). Una clave quitada puede volver con la próxima
 * sync si el nombre la dice; para fijar otro valor, se carga a mano.
 *
 * En `off`/`dual` devuelve null (quien llama relee con `leerAtributos`; en `dual` un fallo de la
 * plataforma se loguea y no tira, como siempre). En `on` la plataforma es la única escritura: un
 * rechazo o una caída TIRA `ErrorGuardadoAtributos`, y en el éxito devuelve los atributos ya
 * guardados (de la instancia que responde la plataforma; si no la trae, lo enviado sobre la
 * proyección, que todavía no recibió el webhook).
 */
export async function guardarAtributosManual(
  tenantId: string,
  alegraId: string,
  valores: AtributoExtraido[],
  quitar: ClaveAtributo[],
): Promise<AtributoGuardado[] | null> {
  const modo = await modoAtributosDe(tenantId)
  // Lo quitado viaja como null: manual es la precedencia máxima, así que borra de cualquier fuente.
  const data: Record<string, Valor | null> = {}
  for (const v of valores) if (v.valorNum != null || v.valorTexto != null) data[v.clave] = { n: v.valorNum, t: v.valorTexto }
  for (const c of quitar) data[c] = null

  if (modo === "on") {
    if (!Object.keys(data).length) return leerAtributos(tenantId, alegraId)
    const instancia = await escribirEnPlataforma(tenantId, alegraId, data, "manual")
    if (instancia) return atributosDeInstancia(instancia)
    const ahora = new Date().toISOString()
    const resto = (await leerAtributos(tenantId, alegraId)).filter((a) => !(a.clave in data))
    const enviados = valores
      .filter((v) => data[v.clave])
      .map((v) => ({ clave: v.clave, valorNum: v.valorNum, valorTexto: v.valorTexto, fuente: "manual" as const, updatedAt: ahora }))
    return ordenarPorClave([...resto, ...enviados])
  }

  await getDb().transaction(async (tx) => {
    if (quitar.length) {
      await tx
        .delete(catalogAtributosLegacy)
        .where(
          and(
            eq(catalogAtributosLegacy.tenantId, tenantId),
            eq(catalogAtributosLegacy.alegraId, alegraId),
            inArray(catalogAtributosLegacy.clave, quitar),
          ),
        )
    }
    if (valores.length) {
      await tx
        .insert(catalogAtributosLegacy)
        .values(
          valores.map((v) => ({
            tenantId,
            alegraId,
            clave: v.clave,
            valorNum: v.valorNum != null ? String(v.valorNum) : null,
            valorTexto: v.valorTexto,
            fuente: "manual",
            updatedAt: sql`now()`,
          })),
        )
        .onConflictDoUpdate({
          target: [catalogAtributosLegacy.tenantId, catalogAtributosLegacy.alegraId, catalogAtributosLegacy.clave],
          set: {
            valorNum: sql`excluded.valor_num`,
            valorTexto: sql`excluded.valor_texto`,
            fuente: sql`excluded.fuente`,
            updatedAt: sql`now()`,
          },
          setWhere: SET_WHERE,
        })
    }
  })
  if (modo === "dual" && Object.keys(data).length) {
    try {
      const t = await tenantPlataforma(tenantId)
      if (t) await escribirProductosPlataforma(t, [{ alegraId, data }], "manual")
    } catch (err) {
      console.warn(`[plataforma] atributos manuales tenant=${tenantId} alegraId=${alegraId}: ${err instanceof Error ? err.message : "error"}`)
    }
  }
  return null
}

/**
 * Hook de la sync de Alegra (y del drenador de webhooks): lo que dice el nombre de los productos
 * tocados pasa a los atributos. TOLERANTE: un error (la migración 0049 sin aplicar, un
 * nombre raro, la base) se loguea y NO rompe la sync, que ya escribió el espejo.
 */
export async function sincronizarAtributosDeNombre(
  tenantId: string,
  productos: readonly ProductoParaExtraer[],
  origen: string,
): Promise<void> {
  if (productos.length === 0) return
  try {
    const r = await reemplazarAtributosDeNombre(tenantId, productos)
    if (r.escritas || r.borradas) {
      console.info(`[catalogo-atributos] tenant=${tenantId} origen=${origen} escritas=${r.escritas} borradas=${r.borradas}`)
    }
  } catch (err) {
    console.warn(
      `[catalogo-atributos] tenant=${tenantId} origen=${origen} no se pudieron escribir los atributos del nombre: ${
        err instanceof Error ? err.message : "error"
      }`,
    )
  }
}
