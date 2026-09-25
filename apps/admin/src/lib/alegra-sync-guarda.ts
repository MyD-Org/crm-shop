import { and, desc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogSyncLog } from "@/db/schema"

// Guarda de la sync del catálogo (change `catalogo-shop-desde-crm`, D7). El CRM es la única
// fuente del catálogo del Shop: una corrida que Alegra cortó a mitad (página vacía, 429 mal
// leído) no puede dar de baja lo que no vio. Si la corrida es sensiblemente más corta que la
// última OK del MISMO tenant, `syncCatalog` upsertea lo leído pero no marca stale ni empuja el
// overlay, y deja el log en 'parcial'. Productos y categorías se evalúan por separado: una
// anomalía de uno no bloquea al otro.

/** Se acepta hasta un 5 % menos que la última corrida OK. */
export const UMBRAL_CORRIDA = 0.95
/** …y siempre hasta 10 menos (catálogos chicos, tests). */
export const TOLERANCIA_CORRIDA = 10

export interface Conteo {
  items: number
  categorias: number
}

export interface EvaluacionCorrida {
  /** parcialItems || parcialCategorias: el log queda 'parcial'. */
  parcial: boolean
  /** No empujar el overlay ni marcar stale productos. */
  parcialItems: boolean
  /** No marcar stale categorías. */
  parcialCategorias: boolean
  /** Sólo números, nunca datos de Alegra. null si no es parcial. */
  motivo: string | null
}

const PORCENTAJE = `${Math.round(UMBRAL_CORRIDA * 100)} %`

function cayoDemasiado(actual: number, base: number): boolean {
  return base - actual > Math.max(TOLERANCIA_CORRIDA, base * (1 - UMBRAL_CORRIDA))
}

export function evaluarCorrida(
  actual: Conteo,
  base: Conteo | null,
  opts: { aceptarBaja?: boolean } = {},
): EvaluacionCorrida {
  if (opts.aceptarBaja) return { parcial: false, parcialItems: false, parcialCategorias: false, motivo: null }

  const motivos: string[] = []

  // Nunca con 0 ítems, haya base o no.
  const parcialItems = actual.items === 0 || (base !== null && cayoDemasiado(actual.items, base.items))
  if (parcialItems) {
    motivos.push(
      base === null
        ? `items ${actual.items} (sin corrida ok previa)`
        : `items ${actual.items} < base ${base.items} (umbral ${PORCENTAJE})`,
    )
  }

  // Categorías: sólo con base (un tenant puede no tener categorías en Alegra).
  const parcialCategorias =
    base !== null &&
    base.categorias > 0 &&
    (actual.categorias === 0 || cayoDemasiado(actual.categorias, base.categorias))
  if (parcialCategorias && base) {
    motivos.push(`categorias ${actual.categorias} < base ${base.categorias} (umbral ${PORCENTAJE})`)
  }

  return {
    parcial: parcialItems || parcialCategorias,
    parcialItems,
    parcialCategorias,
    motivo: motivos.length ? motivos.join("; ") : null,
  }
}

/** Conteos de la ÚLTIMA corrida 'ok' del tenant (ni 'parcial' ni 'error' bajan la vara). */
export async function baseDeCorrida(tenantId: string): Promise<Conteo | null> {
  const [row] = await getDb()
    .select({ items: catalogSyncLog.itemsSynced, categorias: catalogSyncLog.categoriesSynced })
    .from(catalogSyncLog)
    .where(and(eq(catalogSyncLog.tenantId, tenantId), eq(catalogSyncLog.status, "ok")))
    .orderBy(desc(catalogSyncLog.startedAt))
    .limit(1)
  return row ?? null
}
