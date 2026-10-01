import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogAtributos } from "@/db/schema"
import {
  CLAVES_ATRIBUTO,
  extraerAtributosDeNombre,
  type AtributoExtraido,
  type ClaveAtributo,
} from "./catalogo-atributos-extraccion"

// Escritura y lectura de `public.catalog_atributos` (migración 0049).
//
// PRECEDENCIA: manual > pdf > nombre. Una escritura NUNCA pisa una fila de mayor precedencia, y la
// regla vive en el SQL del upsert (ON CONFLICT … DO UPDATE … WHERE), no sólo en TS: dos escrituras
// concurrentes (la sync y el panel) no pueden saltearla. Misma precedencia ⇒ se pisa (idempotente:
// correr dos veces el backfill da lo mismo). Si el valor no cambió no se toca la fila (no mueve
// `updated_at` en cada sync diaria).
//
// Filas `nombre` que dejaron de salir del nombre (renombraron el producto en Alegra): se BORRAN en
// `reemplazarAtributosDeNombre`. Nunca se borra una fila `pdf` o `manual` desde la sync.

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
const SET_WHERE = sql`${rango(`excluded."fuente"`)} >= ${rango(`"catalog_atributos"."fuente"`)} AND (
  "catalog_atributos"."valor_num" IS DISTINCT FROM excluded."valor_num"
  OR "catalog_atributos"."valor_texto" IS DISTINCT FROM excluded."valor_texto"
  OR "catalog_atributos"."fuente" IS DISTINCT FROM excluded."fuente"
)`

export interface FilaAtributo extends AtributoExtraido {
  alegraId: string
}

/**
 * Upsert con precedencia. Devuelve cuántas filas quedaron escritas (insertadas o actualizadas);
 * las que una fuente de mayor precedencia protegía no cuentan.
 */
export async function upsertAtributos(tenantId: string, filas: FilaAtributo[], fuente: FuenteAtributo): Promise<number> {
  // Una sola fila por (producto, clave) por INSERT: Postgres no deja tocar dos veces la misma.
  const unicas = [...new Map(filas.map((f) => [`${f.alegraId}|${f.clave}`, f])).values()].filter(
    (f) => f.valorNum != null || f.valorTexto != null,
  )
  let escritas = 0
  for (let i = 0; i < unicas.length; i += LOTE) {
    const res = await getDb()
      .insert(catalogAtributos)
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
        target: [catalogAtributos.tenantId, catalogAtributos.alegraId, catalogAtributos.clave],
        set: {
          valorNum: sql`excluded.valor_num`,
          valorTexto: sql`excluded.valor_texto`,
          fuente: sql`excluded.fuente`,
          updatedAt: sql`now()`,
        },
        setWhere: SET_WHERE,
      })
      .returning({ clave: catalogAtributos.clave })
    escritas += res.length
  }
  return escritas
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
 * Lo que dice el NOMBRE de estos productos pasa a `catalog_atributos` (fuente `nombre`), y las
 * filas `nombre` que ya no salen del nombre se borran. Las `pdf`/`manual` no se tocan. Idempotente.
 */
export async function reemplazarAtributosDeNombre(
  tenantId: string,
  productos: readonly ProductoParaExtraer[],
): Promise<{ escritas: number; borradas: number }> {
  const unicos = [...new Map(productos.map((p) => [p.alegraId, p])).values()]
  let escritas = 0
  let borradas = 0
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE)
    const filas = filasDeNombre(lote)
    escritas += await upsertAtributos(tenantId, filas, "nombre")
    const conservar = filas.map((f) => `${f.alegraId}|${f.clave}`)
    const ids = lote.map((p) => p.alegraId)
    const res = await getDb()
      .delete(catalogAtributos)
      .where(
        and(
          eq(catalogAtributos.tenantId, tenantId),
          eq(catalogAtributos.fuente, "nombre"),
          inArray(catalogAtributos.alegraId, ids),
          conservar.length
            ? sql`(${catalogAtributos.alegraId} || '|' || ${catalogAtributos.clave}) NOT IN (${sql.join(
                conservar.map((c) => sql`${c}`),
                sql`, `,
              )})`
            : undefined,
        ),
      )
      .returning({ clave: catalogAtributos.clave })
    borradas += res.length
  }
  return { escritas, borradas }
}

export interface AtributoGuardado extends AtributoExtraido {
  fuente: FuenteAtributo
  updatedAt: string
}

/** Atributos de un producto, en el orden de las claves. */
export async function leerAtributos(tenantId: string, alegraId: string): Promise<AtributoGuardado[]> {
  const filas = await getDb()
    .select()
    .from(catalogAtributos)
    .where(and(eq(catalogAtributos.tenantId, tenantId), eq(catalogAtributos.alegraId, alegraId)))
    .orderBy(asc(catalogAtributos.clave))
  const orden = (c: string) => CLAVES_ATRIBUTO.indexOf(c as ClaveAtributo)
  return filas
    .map((f) => ({
      clave: f.clave as ClaveAtributo,
      valorNum: f.valorNum != null ? Number(f.valorNum) : null,
      valorTexto: f.valorTexto,
      fuente: f.fuente as FuenteAtributo,
      updatedAt: f.updatedAt.toISOString(),
    }))
    .sort((a, b) => orden(a.clave) - orden(b.clave))
}

/**
 * Panel manual: los valores dados quedan `manual` (le ganan a todo) y las claves de `quitar` se
 * borran (de cualquier fuente: "este dato está mal"). Una clave quitada puede volver con la próxima
 * sync si el nombre la dice; para fijar otro valor, se carga a mano.
 */
export async function guardarAtributosManual(
  tenantId: string,
  alegraId: string,
  valores: AtributoExtraido[],
  quitar: ClaveAtributo[],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (quitar.length) {
      await tx
        .delete(catalogAtributos)
        .where(
          and(
            eq(catalogAtributos.tenantId, tenantId),
            eq(catalogAtributos.alegraId, alegraId),
            inArray(catalogAtributos.clave, quitar),
          ),
        )
    }
    if (valores.length) {
      await tx
        .insert(catalogAtributos)
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
          target: [catalogAtributos.tenantId, catalogAtributos.alegraId, catalogAtributos.clave],
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
}

/**
 * Hook de la sync de Alegra (y del drenador de webhooks): lo que dice el nombre de los productos
 * tocados pasa a `catalog_atributos`. TOLERANTE: un error (la migración 0049 sin aplicar, un
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
