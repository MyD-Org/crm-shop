import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import type { AlegraProduct } from "./alegra"

// Escritura del espejo de productos (tabla catalog_products). La usan la sync completa
// (lib/alegra-sync.ts) y el drenador de avisos de stock (lib/alegra-stock-cola.ts).
//
// Frescura por fila: cada escritura dice CUÁNDO le pidió el dato a Alegra (`leidoAt`). Las
// columnas que vienen de Alegra sólo se pisan si esa lectura es igual o más nueva que la que ya
// tiene la fila (NULL = −∞). Así la sync de la mañana, que leyó la página del ítem a las 07:00,
// no pisa el stock que un webhook leyó a las 07:01, y un aviso viejo que llega tarde no pisa la
// sync. `synced_at` se actualiza SIEMPRE (la fila fue vista): el marcado de "no visto en la
// corrida" de la sync (synced_at < runStart → inactive) no cambia.

export type LeidoPor = "sync" | "webhook"

const LOTE = 500

/** Columnas de Alegra: se pisan sólo si la lectura nueva no es más vieja que la guardada. */
type ColumnaDeAlegra =
  | "code"
  | "name"
  | "description"
  | "category_alegra_id"
  | "prices"
  | "stock"
  | "status"
  | "alegra_status"
  | "brand"
  | "iva_porcentaje"
  | "raw"
  | "images"
  | "alegra_leido_at"
  | "leido_por"

/** La fila guardada es MÁS fresca que la propuesta: se conserva. Empate → gana la nueva (idempotente). */
const GUARDADA_MAS_FRESCA = `coalesce("catalog_products"."alegra_leido_at", '-infinity'::timestamptz) > excluded."alegra_leido_at"`

function segunFrescura(col: ColumnaDeAlegra) {
  return sql.raw(`CASE WHEN ${GUARDADA_MAS_FRESCA} THEN "catalog_products"."${col}" ELSE excluded."${col}" END`)
}

const SET_POR_FRESCURA = {
  code: segunFrescura("code"),
  name: segunFrescura("name"),
  description: segunFrescura("description"),
  categoryAlegraId: segunFrescura("category_alegra_id"),
  prices: segunFrescura("prices"),
  stock: segunFrescura("stock"),
  status: segunFrescura("status"),
  alegraStatus: segunFrescura("alegra_status"),
  brand: segunFrescura("brand"),
  ivaPorcentaje: segunFrescura("iva_porcentaje"),
  raw: segunFrescura("raw"),
  images: segunFrescura("images"),
  alegraLeidoAt: segunFrescura("alegra_leido_at"),
  leidoPor: segunFrescura("leido_por"),
  syncedAt: sql`excluded.synced_at`,
} satisfies Record<string, unknown>

function fila(tenantId: string, it: AlegraProduct, leidoAt: Date, leidoPor: LeidoPor, ahora: Date) {
  return {
    tenantId,
    alegraId: it.alegraId,
    code: it.code,
    name: it.name,
    description: it.description,
    categoryAlegraId: it.categoryAlegraId,
    prices: it.prices,
    stock: it.stock != null ? String(it.stock) : null,
    // `status` es "visto" (por la corrida o por una re-lectura), NO el estado de Alegra: el de
    // Alegra va a `alegraStatus`. Antes eran la misma columna y ésta lo pisaba, así que el estado
    // real se perdía y el filtro del bot (`status = 'active'`) no filtraba nada.
    status: "active",
    alegraStatus: it.status,
    brand: it.brand,
    ivaPorcentaje: it.ivaPorcentaje != null ? String(it.ivaPorcentaje) : null,
    raw: it.raw,
    images: it.images,
    syncedAt: ahora,
    alegraLeidoAt: leidoAt,
    leidoPor,
  }
}

/**
 * Inserta o actualiza productos por (tenant, alegra_id), en lotes, respetando la frescura por
 * fila (ver arriba). Si `items` repite un alegra_id (Alegra corrió la paginación mientras se
 * leía), queda el último: Postgres no deja que un mismo INSERT … ON CONFLICT toque dos veces la
 * misma fila.
 */
export async function upsertProductos(
  tenantId: string,
  items: AlegraProduct[],
  opts: { leidoAt: Date; leidoPor: LeidoPor },
): Promise<void> {
  const unicos = [...new Map(items.map((it) => [it.alegraId, it])).values()]
  const db = getDb()
  for (let i = 0; i < unicos.length; i += LOTE) {
    const ahora = new Date()
    await db
      .insert(catalogProducts)
      .values(unicos.slice(i, i + LOTE).map((it) => fila(tenantId, it, opts.leidoAt, opts.leidoPor, ahora)))
      .onConflictDoUpdate({ target: [catalogProducts.tenantId, catalogProducts.alegraId], set: SET_POR_FRESCURA })
  }
}

/**
 * Alegra respondió 404 al re-leer el ítem: queda no disponible (`status='inactive'`), sin borrar
 * la fila, SALVO que ya tenga una lectura más nueva que ésta. Si el ítem no estaba en el espejo
 * no hace nada. Devuelve si marcó la fila.
 */
export async function marcarItemInactivo(tenantId: string, alegraId: string, leidoAt: Date): Promise<boolean> {
  const rows = await getDb()
    .update(catalogProducts)
    .set({ status: "inactive", alegraLeidoAt: leidoAt, leidoPor: "webhook" })
    .where(
      and(
        eq(catalogProducts.tenantId, tenantId),
        eq(catalogProducts.alegraId, alegraId),
        sql`coalesce(${catalogProducts.alegraLeidoAt}, '-infinity'::timestamptz) <= ${leidoAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: catalogProducts.id })
  return rows.length > 0
}
