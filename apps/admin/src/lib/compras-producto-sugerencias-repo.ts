import { and, eq, ilike, isNotNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts, compraItems, compras } from "@/db/schema"
import {
  sugerirCodigo,
  sugerirMarca,
  sugerirNombre,
  sugerirPorMarca,
  type FilaCatalogo,
} from "./compras-producto-sugerencias"

// Lectura de la base para las sugerencias de «Crear producto» (S4b). Sólo lectura del catálogo del
// tenant y de las compras previas del proveedor.

export interface SugerenciasAlta {
  marca: string | null
  marcaEsSugerida: boolean
  sufijo: string | null
  sufijoEsNuevo: boolean
  /** Sólo para la cuenta principal: los ids de categoría del catálogo son los de esa cuenta. */
  categoriaId: string | null
  ivaPorcentaje: number | null
  nombre: string
  nombreSoloCodigo: boolean
  codigo: string | null
}

const patron = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

export async function sugerenciasAlta(
  tenantId: string,
  cuenta: { principal: boolean },
  entrada: { texto: string; marca: string; proveedorAlegraId: string },
): Promise<SugerenciasAlta> {
  const db = getDb()
  let marca = entrada.marca.trim()
  let marcaEsSugerida = false
  if (!marca) {
    const previas = entrada.proveedorAlegraId
      ? await db
          .select({ brand: catalogProducts.brand })
          .from(compraItems)
          .innerJoin(compras, and(eq(compras.id, compraItems.compraId), eq(compras.tenantId, compraItems.tenantId)))
          .innerJoin(catalogProducts, and(eq(catalogProducts.tenantId, compraItems.tenantId), eq(catalogProducts.alegraId, compraItems.alegraId)))
          .where(and(eq(compras.tenantId, tenantId), eq(compras.proveedorAlegraId, entrada.proveedorAlegraId), isNotNull(catalogProducts.brand)))
          .limit(500)
      : []
    const marcas = await db
      .selectDistinct({ brand: catalogProducts.brand })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenantId), isNotNull(catalogProducts.brand)))
    const sugerida = sugerirMarca(
      previas.map((p) => p.brand),
      marcas.map((m) => m.brand ?? ""),
      entrada.texto,
    )
    if (sugerida) {
      marca = sugerida
      marcaEsSugerida = true
    }
  }

  let filas: FilaCatalogo[] = []
  if (marca) {
    const r = await db
      .select({
        code: catalogProducts.code,
        name: catalogProducts.name,
        brand: catalogProducts.brand,
        iva: catalogProducts.ivaPorcentaje,
        categoryAlegraId: catalogProducts.categoryAlegraId,
      })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenantId), ilike(catalogProducts.brand, patron(marca)), sql`${catalogProducts.status} = 'active'`))
      .limit(2000)
    filas = r.map((x) => ({ code: x.code, name: x.name, brand: x.brand, ivaPorcentaje: x.iva === null ? null : Number(x.iva), categoryAlegraId: x.categoryAlegraId }))
  }
  const porMarca = sugerirPorMarca(filas, marca)
  const { nombre, soloCodigo } = sugerirNombre(entrada.texto)
  return {
    marca: marca || null,
    marcaEsSugerida,
    sufijo: porMarca.sufijo,
    sufijoEsNuevo: porMarca.sufijoEsNuevo,
    categoriaId: cuenta.principal ? porMarca.categoriaId : null,
    ivaPorcentaje: porMarca.ivaPorcentaje,
    nombre,
    nombreSoloCodigo: soloCodigo,
    codigo: sugerirCodigo(entrada.texto),
  }
}
