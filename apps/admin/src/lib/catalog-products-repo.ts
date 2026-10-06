import { and, eq, isNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import type { AlegraProduct } from "./alegra"
import { recalcularTrasSync } from "./precios-online-costos"

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
  | "costo"
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
  // `costo_aplicado` NO está acá a propósito: lo gobierna la retención por variación de costo.
  costo: segunFrescura("costo"),
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
    costo: it.costo != null ? String(it.costo) : null,
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
  // Listas de precio online (0064): el costo nuevo se aplica o se retiene. Cubre la sync de la
  // principal y el webhook (ambos escriben por acá). Best-effort: nunca tumba la escritura.
  await recalcularTrasSync(tenantId, unicos.map((it) => it.alegraId), opts.leidoPor)
}

export interface ProductoSecundaria {
  /** Ya mapeado (`mapItemSecundario`): `alegraId` sintético, listas y categoría de la principal. */
  producto: AlegraProduct
  /** Id real del ítem en SU cuenta. */
  alegraIdCuenta: string
  /** Estado de la fila (`estadoSoloSecundaria`); `active` = visto y ofrecible. */
  estado: "active" | "inactive"
}

/**
 * Upsert de filas SOLO-SECUNDARIA (change `sucursales-igz-mdp`, D14): productos que existen sólo
 * en una cuenta secundaria. Misma frescura por fila que `upsertProductos`; además marca la cuenta
 * de origen y limpia `reemplazado_por_alegra_id` (si la principal la había absorbido y hoy vuelve
 * a ser solo-secundaria, la fila es legítima otra vez). `stock` = stock de la cuenta de origen.
 */
export async function upsertProductosSecundaria(
  tenantId: string,
  cuentaId: string,
  items: ProductoSecundaria[],
  opts: { leidoAt: Date; leidoPor: LeidoPor },
): Promise<void> {
  const unicos = [...new Map(items.map((it) => [it.producto.alegraId, it])).values()]
  const db = getDb()
  for (let i = 0; i < unicos.length; i += LOTE) {
    const ahora = new Date()
    await db
      .insert(catalogProducts)
      .values(
        unicos.slice(i, i + LOTE).map((it) => ({
          ...fila(tenantId, it.producto, opts.leidoAt, opts.leidoPor, ahora),
          status: it.estado,
          cuentaId,
          alegraIdCuenta: it.alegraIdCuenta,
          reemplazadoPorAlegraId: null,
        })),
      )
      .onConflictDoUpdate({
        target: [catalogProducts.tenantId, catalogProducts.alegraId],
        set: {
          ...SET_POR_FRESCURA,
          cuentaId: sql`excluded.cuenta_id`,
          alegraIdCuenta: sql`excluded.alegra_id_cuenta`,
          reemplazadoPorAlegraId: sql`null`,
        },
      })
  }
  // Ídem `upsertProductos`: las filas solo-secundaria también reciben su precio online.
  await recalcularTrasSync(tenantId, unicos.map((it) => it.producto.alegraId), opts.leidoPor)
}

/**
 * Alegra respondió 404 al re-leer el ítem: queda no disponible (`status='inactive'`), sin borrar
 * la fila, SALVO que ya tenga una lectura más nueva que ésta. Si el ítem no estaba en el espejo
 * no hace nada. Devuelve si marcó la fila. Sólo filas de la cuenta PRINCIPAL (`cuenta_id IS NULL`):
 * el `alegraId` que llega es un id numérico de esa cuenta y una fila solo-secundaria lleva id
 * sintético, así que nunca deberían cruzarse; el filtro lo deja explícito.
 */
export async function marcarItemInactivo(tenantId: string, alegraId: string, leidoAt: Date): Promise<boolean> {
  const rows = await getDb()
    .update(catalogProducts)
    .set({ status: "inactive", alegraLeidoAt: leidoAt, leidoPor: "webhook" })
    .where(
      and(
        eq(catalogProducts.tenantId, tenantId),
        eq(catalogProducts.alegraId, alegraId),
        isNull(catalogProducts.cuentaId),
        sql`coalesce(${catalogProducts.alegraLeidoAt}, '-infinity'::timestamptz) <= ${leidoAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: catalogProducts.id })
  return rows.length > 0
}
