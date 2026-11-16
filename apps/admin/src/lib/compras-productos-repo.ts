import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { resolverIdsEnCuentaSinCrear, type CuentaDestino } from "./alegra-items-cuenta"

// Buscador de productos de Compras (change `compras-en-transito`, S4). Sólo lectura de la base.
// El costo de referencia viaja ÚNICAMENTE desde la ruta de Compras, ya detrás de
// `requireComprasAccess` (el rol «compras» ve costos por naturaleza del módulo).

export interface ProductoCompraDto {
  alegraId: string
  codigo: string | null
  nombre: string
  marca: string | null
  ivaPorcentaje: number | null
  costoReferencia: number | null
  /** Id real del ítem en la cuenta elegida; null = no se conoce (hay que cargarlo o buscarlo en Alegra). */
  itemIdCuenta: string | null
  sinItemEnCuenta: boolean
}

const patron = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

export async function buscarProductosCompra(
  tenantId: string,
  cuenta: CuentaDestino,
  q: string,
  limite = 20,
): Promise<ProductoCompraDto[]> {
  const texto = q.trim()
  if (texto.length < 2) return []
  const filas = await getDb()
    .select({
      alegraId: catalogProducts.alegraId,
      code: catalogProducts.code,
      name: catalogProducts.name,
      brand: catalogProducts.brand,
      iva: catalogProducts.ivaPorcentaje,
      costo: catalogProducts.costo,
    })
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.tenantId, tenantId),
        eq(catalogProducts.status, "active"),
        isNull(catalogProducts.reemplazadoPorAlegraId),
        // Los «padres» de variantes no son vendibles ni comprables: sí sus variantes.
        sql`${catalogProducts.tipo} <> 'padre'`,
        or(ilike(catalogProducts.name, patron(texto)), ilike(catalogProducts.code, patron(texto))),
      ),
    )
    .orderBy(catalogProducts.name)
    .limit(limite)
  const { ids } = await resolverIdsEnCuentaSinCrear(tenantId, cuenta, filas.map((f) => f.alegraId))
  return filas.map((f) => {
    const itemIdCuenta = ids.get(f.alegraId) ?? null
    return {
      alegraId: f.alegraId,
      codigo: f.code,
      nombre: f.name,
      marca: f.brand,
      ivaPorcentaje: f.iva === null ? null : Number(f.iva),
      costoReferencia: f.costo === null ? null : Number(f.costo),
      itemIdCuenta,
      sinItemEnCuenta: itemIdCuenta === null,
    }
  })
}

export interface ProductoBasico {
  alegraId: string
  codigo: string | null
  nombre: string
}

/** Datos del catálogo de los ids pedidos (para guardar nombre y código en la compra). */
export async function productosPorAlegraId(tenantId: string, ids: string[]): Promise<Map<string, ProductoBasico>> {
  if (ids.length === 0) return new Map()
  const filas = await getDb()
    .select({ alegraId: catalogProducts.alegraId, code: catalogProducts.code, name: catalogProducts.name })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.alegraId, ids)))
  return new Map(filas.map((f) => [f.alegraId, { alegraId: f.alegraId, codigo: f.code, nombre: f.name }]))
}
