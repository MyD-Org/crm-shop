import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogDatosEnvio } from "@/db/schema"
import type { DatosEnvio, FuenteDatosEnvio } from "@/lib/catalogo-datos-envio"

// Lectura y carga de `catalog_datos_envio` (migración 0107). No avisa al Shop: estos datos no viajan
// a la tienda.

const aNumero = (v: string | null) => (v === null ? null : Number(v))
const aTexto = (v: number | null) => (v === null ? null : String(v))

export async function leerDatosEnvio(tenantId: string, alegraId: string): Promise<DatosEnvio | null> {
  const [f] = await getDb()
    .select()
    .from(catalogDatosEnvio)
    .where(and(eq(catalogDatosEnvio.tenantId, tenantId), eq(catalogDatosEnvio.alegraId, alegraId)))
    .limit(1)
  if (!f) return null
  return {
    pesoKg: aNumero(f.pesoKg),
    altoCm: aNumero(f.altoCm),
    anchoCm: aNumero(f.anchoCm),
    largoCm: aNumero(f.largoCm),
    unidadMinima: f.unidadMinima,
    unidadesPorCaja: f.unidadesPorCaja,
    fuente: f.fuente as FuenteDatosEnvio,
    updatedAt: f.updatedAt.toISOString(),
  }
}

/**
 * Upsert en lote. Un dato cargado a mano (`fuente = 'manual'`) le gana a cualquier carga
 * automática: las filas que no son 'manual' no lo pisan. Devuelve cuántas filas se escribieron.
 */
export async function guardarDatosEnvio(
  tenantId: string,
  filas: { alegraId: string; datos: DatosEnvio }[],
): Promise<number> {
  if (filas.length === 0) return 0
  let escritas = 0
  const LOTE = 500
  for (let i = 0; i < filas.length; i += LOTE) {
    const valores = filas.slice(i, i + LOTE).map(({ alegraId, datos }) => ({
      tenantId,
      alegraId,
      pesoKg: aTexto(datos.pesoKg),
      altoCm: aTexto(datos.altoCm),
      anchoCm: aTexto(datos.anchoCm),
      largoCm: aTexto(datos.largoCm),
      unidadMinima: datos.unidadMinima,
      unidadesPorCaja: datos.unidadesPorCaja,
      fuente: datos.fuente,
    }))
    const res = await getDb()
      .insert(catalogDatosEnvio)
      .values(valores)
      .onConflictDoUpdate({
        target: [catalogDatosEnvio.tenantId, catalogDatosEnvio.alegraId],
        set: {
          pesoKg: sql`excluded.peso_kg`,
          altoCm: sql`excluded.alto_cm`,
          anchoCm: sql`excluded.ancho_cm`,
          largoCm: sql`excluded.largo_cm`,
          unidadMinima: sql`excluded.unidad_minima`,
          unidadesPorCaja: sql`excluded.unidades_por_caja`,
          fuente: sql`excluded.fuente`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${catalogDatosEnvio.fuente} <> 'manual' OR excluded.fuente = 'manual'`,
      })
      .returning({ alegraId: catalogDatosEnvio.alegraId })
    escritas += res.length
  }
  return escritas
}
