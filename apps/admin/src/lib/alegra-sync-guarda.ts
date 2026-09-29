import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm"
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

/** `cuenta_id` NULL = la principal (las corridas de antes de las cuentas secundarias). */
const deCuenta = (cuentaId: string | null | undefined): SQL =>
  cuentaId ? eq(catalogSyncLog.cuentaId, cuentaId) : (isNull(catalogSyncLog.cuentaId) as SQL)

/**
 * Conteos de la ÚLTIMA corrida 'ok' de la cuenta del tenant (ni 'parcial' ni 'error' bajan la
 * vara). Sin `cuentaId` es la cuenta principal. Cada cuenta tiene su propia base: la secundaria
 * lee muchos menos ítems que la principal y no puede compararse con ella.
 */
export async function baseDeCorrida(tenantId: string, cuentaId?: string | null): Promise<Conteo | null> {
  const [row] = await getDb()
    .select({ items: catalogSyncLog.itemsSynced, categorias: catalogSyncLog.categoriesSynced })
    .from(catalogSyncLog)
    .where(and(eq(catalogSyncLog.tenantId, tenantId), deCuenta(cuentaId), eq(catalogSyncLog.status, "ok")))
    .orderBy(desc(catalogSyncLog.startedAt))
    .limit(1)
  return row ?? null
}

/**
 * Una corrida 'running' más nueva que esto cuenta como en curso. Más vieja = quedó colgada (la
 * ruta muere a los 300 s) y no bloquea para siempre.
 */
export const VENTANA_CORRIDA_EN_CURSO_MIN = 10

/**
 * Guarda de concurrencia POR CUENTA: abre el log 'running' de la corrida sólo si no hay otra en
 * curso para la misma cuenta del tenant (la principal = `cuentaId` NULL). El chequeo y el insert
 * van en una transacción con un lock advisory por (tenant, cuenta), así dos corridas simultáneas
 * (cron + botón manual) no pasan las dos. Devuelve el id del log o null si ya hay una en curso.
 * La base (`baseDeCorrida`) se toma ANTES de llamar acá, para que no cuente el log recién abierto.
 */
export async function abrirCorrida(
  tenantId: string,
  cuentaId: string | null,
  trigger: "cron" | "manual",
  startedAt: Date,
): Promise<string | null> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`alegra-sync:${tenantId}:${cuentaId ?? "principal"}`}))`)
    const [enCurso] = await tx
      .select({ id: catalogSyncLog.id })
      .from(catalogSyncLog)
      .where(
        and(
          eq(catalogSyncLog.tenantId, tenantId),
          deCuenta(cuentaId),
          eq(catalogSyncLog.status, "running"),
          sql`${catalogSyncLog.startedAt} > now() - make_interval(mins => ${VENTANA_CORRIDA_EN_CURSO_MIN})`,
        ),
      )
      .limit(1)
    if (enCurso) return null
    const [log] = await tx
      .insert(catalogSyncLog)
      .values({ tenantId, cuentaId, trigger, status: "running", startedAt })
      .returning({ id: catalogSyncLog.id })
    return log.id
  })
}

export const MSG_SYNC_EN_CURSO = "Ya hay una sincronización en curso para esta cuenta. Inténtelo nuevamente en unos minutos."
