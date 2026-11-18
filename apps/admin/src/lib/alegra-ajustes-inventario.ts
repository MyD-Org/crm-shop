import { and, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, alegraDocumentoItems } from "@/db/schema"
import { alegraFetch } from "./alegra"
import { motivoError } from "./alegra-webhook-comun"
import { encolar } from "./alegra-stock-cola"
import { configParaCuenta } from "./sucursales-cuenta"
import type { TenantConfig } from "./tenants"

// Ajustes de inventario de Alegra → cola de re-lectura de stock.
//
// Alegra NO avisa por webhook cuando se carga un ajuste de inventario (solo facturas, compras e
// ítems), así que el stock cargado por ajuste esperaba a la sync diaria. El cron del drenaje llama
// a `encolarAjustesRecientes` antes de drenar: pide a cada cuenta (principal y secundarias
// activas) sus últimos ajustes —UN request por cuenta— y encola los ítems de los que no vio.
//
// - "Visto" = está en `alegra_documento_items` con tipo `inventory-adjustment` y la misma huella
//   (ítems y cantidades). Un ajuste editado cambia la huella y se vuelve a encolar.
// - Secundarias: el doc y los ítems llevan el prefijo `<slug>:` (mismo formato que la cola).
// - Solo se miran los ajustes de los últimos `DIAS_ATRAS` días: lo anterior lo cubre la sync.
// - Best-effort por cuenta: un error (429, credenciales) se loguea y sigue con la próxima.
// - Logs: tenant, cuenta y conteos. Nunca datos de Alegra.

export const TIPO_AJUSTE = "inventory-adjustment"
const DIAS_ATRAS = 2
const LIMITE = 30

export interface AjusteInventario {
  id: string
  date: string
  /** Ítems del ajuste (ids de la cuenta, sin prefijo). */
  itemIds: string[]
  /** Ítems y cantidades ordenados: cambia si se edita el ajuste. */
  huella: string
}

/** Normaliza la respuesta de GET /inventory-adjustments (array o `{ data }`). */
export function parsearAjustes(raw: unknown): AjusteInventario[] {
  const lista = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown })?.data) ? (raw as { data: unknown[] }).data : []
  const out: AjusteInventario[] = []
  for (const a of lista as Record<string, unknown>[]) {
    if (a?.id == null || typeof a.date !== "string") continue
    const items = (Array.isArray(a.items) ? a.items : []) as Record<string, unknown>[]
    const pares = items
      .filter((i) => i?.id != null)
      .map((i) => `${String(i.id)}:${String(i.quantity ?? "")}:${String(i.type ?? "")}`)
      .sort()
    out.push({
      id: String(a.id),
      date: a.date,
      itemIds: [...new Set(items.filter((i) => i?.id != null).map((i) => String(i.id)))],
      huella: pares.join("|"),
    })
  }
  return out
}

/** Fecha (YYYY-MM-DD, hora de Argentina) desde la que se miran los ajustes. */
export function fechaDesde(ahora: Date, dias = DIAS_ATRAS): string {
  const ar = new Date(ahora.getTime() - 3 * 3600_000 - dias * 86400_000)
  return ar.toISOString().slice(0, 10)
}

/** Ajustes recientes que no están en el índice con la misma huella. */
export function ajustesNuevos(ajustes: AjusteInventario[], vistos: Map<string, string | null>, desde: string): AjusteInventario[] {
  return ajustes.filter((a) => a.date >= desde && a.itemIds.length > 0 && vistos.get(a.id) !== a.huella)
}

export interface ResultadoAjustes {
  ajustes: number
  encolados: number
  errores: number
}

interface Cuenta {
  /** "" para la principal; si no, el slug que prefija ids. */
  prefijo: string
  config: TenantConfig
}

async function cuentasDe(base: TenantConfig): Promise<Cuenta[]> {
  const secundarias = await getDb()
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, base.id), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
  const out: Cuenta[] = [{ prefijo: "", config: base }]
  for (const c of secundarias) {
    try {
      out.push({ prefijo: `${c.slug}:`, config: configParaCuenta(base, c) })
    } catch {
      console.warn(`[alegra-ajustes] tenant=${base.id} cuenta=${c.slug} sin credenciales`)
    }
  }
  return out
}

export interface DepsAjustes {
  listar: (config: TenantConfig) => Promise<unknown>
  cuentas: (base: TenantConfig) => Promise<Cuenta[]>
  ahora: () => Date
}

const DEPS: DepsAjustes = {
  listar: (config) =>
    alegraFetch(config, "/inventory-adjustments", { start: "0", limit: String(LIMITE), order_direction: "DESC" }, undefined, {
      reintentos429: 0,
    }),
  cuentas: cuentasDe,
  ahora: () => new Date(),
}

export async function encolarAjustesRecientes(base: TenantConfig, deps: DepsAjustes = DEPS): Promise<ResultadoAjustes> {
  const r: ResultadoAjustes = { ajustes: 0, encolados: 0, errores: 0 }
  if (base.alegraMock) return r
  const desde = fechaDesde(deps.ahora())
  const db = getDb()

  for (const cuenta of await deps.cuentas(base)) {
    if (cuenta.config.alegraMock) continue
    try {
      const recientes = parsearAjustes(await deps.listar(cuenta.config)).filter((a) => a.date >= desde)
      if (recientes.length === 0) continue
      const docIds = recientes.map((a) => cuenta.prefijo + a.id)
      const filas = await db
        .select({ id: alegraDocumentoItems.alegraDocId, estado: alegraDocumentoItems.estado })
        .from(alegraDocumentoItems)
        .where(
          and(
            eq(alegraDocumentoItems.tenantId, base.id),
            eq(alegraDocumentoItems.tipo, TIPO_AJUSTE),
            inArray(alegraDocumentoItems.alegraDocId, docIds),
          ),
        )
      const vistos = new Map(filas.map((f) => [f.id.slice(cuenta.prefijo.length), f.estado]))
      const nuevos = ajustesNuevos(recientes, vistos, desde)
      if (nuevos.length === 0) continue

      await db.transaction(async (tx) => {
        const ids = nuevos.flatMap((a) => a.itemIds.map((i) => cuenta.prefijo + i))
        r.encolados += await encolar(tx, base.id, ids, TIPO_AJUSTE)
        for (const a of nuevos) {
          await tx
            .insert(alegraDocumentoItems)
            .values({
              tenantId: base.id,
              tipo: TIPO_AJUSTE,
              alegraDocId: cuenta.prefijo + a.id,
              itemIds: a.itemIds.map((i) => cuenta.prefijo + i),
              estado: a.huella,
              actualizadoAt: sql`now()`,
            })
            .onConflictDoUpdate({
              target: [alegraDocumentoItems.tenantId, alegraDocumentoItems.tipo, alegraDocumentoItems.alegraDocId],
              set: { itemIds: sql`excluded.item_ids`, estado: sql`excluded.estado`, actualizadoAt: sql`now()` },
            })
        }
      })
      r.ajustes += nuevos.length
    } catch (err) {
      r.errores++
      console.warn(`[alegra-ajustes] tenant=${base.id} cuenta=${cuenta.prefijo || "principal"} error=${motivoError(err)}`)
    }
  }
  if (r.ajustes > 0) console.log(`[alegra-ajustes] tenant=${base.id} ajustes=${r.ajustes} encolados=${r.encolados}`)
  return r
}
