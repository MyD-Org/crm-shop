import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  catalogOverlay,
  catalogProducts,
  listaPrecioOverrides,
  listasPrecioOnline,
  shopCategories,
} from "@/db/schema"

// Siembra de datos SINTÉTICOS para los tests de precios online (change `listas-precio-online`).

export async function seedCategoria(
  tenantId: string,
  slug: string,
  parentId: string | null = null,
  nivel = 1,
): Promise<string> {
  const [c] = await getDb()
    .insert(shopCategories)
    .values({ tenantId, parentId, nombre: `Categoría ${slug}`, slug, nivel })
    .returning({ id: shopCategories.id })
  return c.id
}

export async function seedLista(
  tenantId: string,
  nombre: string,
  coeficiente: string,
  opts: { esReferencia?: boolean; orden?: number; activa?: boolean; privada?: boolean } = {},
): Promise<string> {
  const [l] = await getDb()
    .insert(listasPrecioOnline)
    .values({
      tenantId,
      nombre,
      coeficiente,
      esReferencia: opts.esReferencia ?? false,
      orden: opts.orden ?? 0,
      activa: opts.activa ?? true,
      privada: opts.privada ?? false,
    })
    .returning({ id: listasPrecioOnline.id })
  return l.id
}

export async function seedOverrideMarca(tenantId: string, listaId: string, marca: string, coeficiente: string) {
  await getDb().insert(listaPrecioOverrides).values({ tenantId, listaId, tipo: "marca", marca, coeficiente })
}

export async function seedOverrideCategoria(tenantId: string, listaId: string, categoriaId: string, coeficiente: string) {
  await getDb().insert(listaPrecioOverrides).values({ tenantId, listaId, tipo: "categoria", categoriaId, coeficiente })
}

export interface ProductoSeed {
  alegraId: string
  costo?: string | null
  /** Por defecto = costo (como el backfill de 0063: el costo ya está aplicado). */
  costoAplicado?: string | null
  brand?: string | null
  categoriaId?: string | null
  status?: string
  rawPrice?: unknown[]
}

export async function seedProducto(tenantId: string, p: ProductoSeed): Promise<void> {
  const costo = p.costo === undefined ? null : p.costo
  await getDb()
    .insert(catalogProducts)
    .values({
      tenantId,
      alegraId: p.alegraId,
      code: `REF-${p.alegraId}`,
      name: `Producto ${p.alegraId}`,
      status: p.status ?? "active",
      brand: p.brand ?? null,
      costo,
      costoAplicado: p.costoAplicado === undefined ? costo : p.costoAplicado,
      raw: { price: p.rawPrice ?? [{ idPriceList: "1", name: "Lista de Alegra", price: 999 }] },
    })
  if (p.categoriaId) {
    await getDb()
      .insert(catalogOverlay)
      .values({ tenantId, alegraId: p.alegraId, categoriaId: p.categoriaId })
  }
}

export interface FilaCalculo {
  alegra_id: string
  lista_id: string
  costo_base: string | null
  coef: string
  origen: string
  precio: string | null
}

export async function calcular(tenantId: string, ids: string[] | null = null): Promise<FilaCalculo[]> {
  const idsSql = ids ? sql`${sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(",")}]::text[]`)}` : sql`NULL::text[]`
  return (await getDb().execute(
    sql`SELECT * FROM calcular_precios_online(${tenantId}, ${idsSql}) ORDER BY alegra_id, lista_id`,
  )) as unknown as FilaCalculo[]
}

export async function aplicar(
  tenantId: string,
  ids: string[] | null,
  modo: "config" | "costo",
): Promise<{ actualizados: number; retenidos: number }> {
  const idsSql = ids ? sql`${sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(",")}]::text[]`)}` : sql`NULL::text[]`
  const rows = (await getDb().execute(
    sql`SELECT * FROM aplicar_precios_online(${tenantId}, ${idsSql}, ${modo})`,
  )) as unknown as { actualizados: number; retenidos: number }[]
  return rows[0]
}
