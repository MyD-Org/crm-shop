import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogPreciosCuenta } from "@/db/schema"
import type { AlegraProduct } from "./alegra"

// Espejo de precios por lista y costo de las cuentas SECUNDARIAS (change `listas-alegra-desde-costo`,
// R1, migración 0104). Lo escriben la sync de la cuenta (todos los ítems que lee) y el refresco por
// webhook (un ítem). TODO filtra por tenant y cuenta. Guarda de frescura: una lectura más vieja no
// pisa a una más nueva (`leido_at <= excluded.leido_at`).

const LOTE = 500

export interface FilaPreciosCuenta {
  itemId: string
  tipo: string
  estado: string
  precios: { idPriceList: string; name: string; price: number }[]
  /** inventory.unitCost sin IVA; null = sin costo (0 o inválido). */
  costo: number | null
}

/** Fila del espejo a partir de un ítem leído de la cuenta (`alegraId` = id EN esa cuenta). */
export function filaDePrecios(item: AlegraProduct): FilaPreciosCuenta {
  return {
    itemId: item.alegraId,
    tipo: item.tipo ?? "simple",
    estado: item.status || "active",
    precios: item.prices.map((p) => ({ idPriceList: String(p.idPriceList), name: p.name, price: p.price })),
    costo: item.costo ?? null,
  }
}

function lotes<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/**
 * Upsert por lotes de 500 de los ítems leídos. No pisa una fila con `leido_at` más nuevo. Devuelve
 * la cantidad de ítems procesados (no necesariamente actualizados).
 */
export async function upsertPreciosCuenta(
  tenantId: string,
  cuentaId: string,
  items: AlegraProduct[],
  leidoAt: Date,
): Promise<number> {
  const db = getDb()
  const unicos = [...new Map(items.map((it) => [it.alegraId, filaDePrecios(it)])).values()]
  for (const lote of lotes(unicos, LOTE)) {
    const ahora = new Date()
    await db
      .insert(catalogPreciosCuenta)
      .values(
        lote.map((f) => ({
          tenantId,
          cuentaId,
          itemId: f.itemId,
          tipo: f.tipo,
          estado: f.estado,
          precios: f.precios,
          costo: f.costo === null ? null : String(f.costo),
          leidoAt,
          syncedAt: ahora,
        })),
      )
      .onConflictDoUpdate({
        target: [catalogPreciosCuenta.tenantId, catalogPreciosCuenta.cuentaId, catalogPreciosCuenta.itemId],
        set: {
          tipo: sql`excluded.tipo`,
          estado: sql`excluded.estado`,
          precios: sql`excluded.precios`,
          costo: sql`excluded.costo`,
          leidoAt: sql`excluded.leido_at`,
          syncedAt: sql`excluded.synced_at`,
        },
        setWhere: sql`coalesce(${catalogPreciosCuenta.leidoAt}, '-infinity'::timestamptz) <= excluded.leido_at`,
      })
  }
  return unicos.length
}

/**
 * Borra los ítems que la lectura completa NO vio: los que tienen `leido_at` anterior al inicio de
 * la corrida (los que escribió la corrida, o un webhook más fresco, quedan). Llamar SÓLO si la
 * lectura no fue parcial. Devuelve cuántos borró.
 */
export async function borrarPreciosNoVistos(tenantId: string, cuentaId: string, corridaDesde: Date): Promise<number> {
  const borradas = await getDb()
    .delete(catalogPreciosCuenta)
    .where(
      and(
        eq(catalogPreciosCuenta.tenantId, tenantId),
        eq(catalogPreciosCuenta.cuentaId, cuentaId),
        sql`coalesce(${catalogPreciosCuenta.leidoAt}, '-infinity'::timestamptz) < ${corridaDesde.toISOString()}::timestamptz`,
      ),
    )
    .returning({ itemId: catalogPreciosCuenta.itemId })
  return borradas.length
}

/** Refresco de UN ítem (webhook). `item = null` (404 en Alegra) borra la fila si no hay una lectura más nueva. */
export async function espejarItemDeCuenta(
  tenantId: string,
  cuentaId: string,
  itemIdEnCuenta: string,
  item: AlegraProduct | null,
  leidoAt: Date,
): Promise<void> {
  if (item) {
    await upsertPreciosCuenta(tenantId, cuentaId, [{ ...item, alegraId: itemIdEnCuenta }], leidoAt)
    return
  }
  await getDb()
    .delete(catalogPreciosCuenta)
    .where(
      and(
        eq(catalogPreciosCuenta.tenantId, tenantId),
        eq(catalogPreciosCuenta.cuentaId, cuentaId),
        eq(catalogPreciosCuenta.itemId, itemIdEnCuenta),
        sql`coalesce(${catalogPreciosCuenta.leidoAt}, '-infinity'::timestamptz) <= ${leidoAt.toISOString()}::timestamptz`,
      ),
    )
}
