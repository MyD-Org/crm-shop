import type { TenantConfig } from "./tenants"
import { syncTenant, type EventoProgreso, type SyncTenantResult } from "./alegra-sync-tenant"

// Lógica del runner de la sync programada (scripts/alegra-sync.ts), separada del script para poder
// testearla: parseo de args, resumen sin secretos y la corrida completa de cada tenant en un solo
// proceso (sin presupuesto de tiempo: el runner de GitHub Actions no tiene el tope de 300 s de
// una función de Vercel).

const ID_TENANT = /^[A-Za-z0-9_-]+$/
/** Red de seguridad: con presupuesto infinito `continuar` no debería aparecer nunca. */
const MAX_VUELTAS = 20

export type ArgsRunner = { ok: true; tenant: string | null; aceptarBaja: boolean } | { ok: false; error: string }

export function parsearArgs(argv: string[]): ArgsRunner {
  let tenant: string | null = null
  let aceptarBaja = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--tenant") {
      tenant = (argv[++i] ?? "").trim()
      if (!ID_TENANT.test(tenant)) return { ok: false, error: "--tenant sólo admite letras, números, guiones y guiones bajos." }
    } else if (a === "--aceptar-baja") {
      aceptarBaja = true
    } else {
      return { ok: false, error: `Argumento desconocido: ${a.slice(0, 40)}` }
    }
  }
  if (aceptarBaja && !tenant) return { ok: false, error: "--aceptar-baja requiere indicar --tenant." }
  return { ok: true, tenant, aceptarBaja }
}

/** El mensaje de error sólo pasa si es corto y no parece un volcado (JSON, URL) de Alegra. */
export function errorCorto(error: string | undefined): string | undefined {
  if (!error) return undefined
  const limpio = error.replace(/\s+/g, " ").trim()
  if (limpio.length > 120 || /[{}[\]]|https?:|@/.test(limpio)) return "detalle omitido (ver catalog_sync_log)"
  return limpio
}

export interface ResumenCuenta {
  cuenta: string
  ok: boolean
  parcial: boolean
  motivo?: string
  error?: string
  itemsSynced: number
  pareados?: number
  soloSecundaria?: number
  duplicados?: number
  sinCodigo?: number
}

export interface ResumenTenant {
  tenant: string
  ok: boolean
  parcial: boolean
  motivo?: string
  error?: string
  itemsSynced: number
  categoriesSynced: number
  cuentas?: ResumenCuenta[]
}

/** Resumen apto para logs públicos: conteos y estado; nunca el detalle crudo ni credenciales. */
export function resumir(tenant: string, r: SyncTenantResult): ResumenTenant {
  const cuentas: ResumenCuenta[] = (r.cuentas ?? []).map((c) => ({
    cuenta: c.cuenta,
    ok: c.ok,
    parcial: c.parcial === true,
    motivo: c.motivo,
    error: errorCorto(c.error),
    itemsSynced: c.itemsSynced,
    pareados: c.pareados,
    soloSecundaria: c.soloSecundaria,
    duplicados: c.duplicados,
    sinCodigo: c.sinCodigo,
  }))
  return {
    tenant,
    ok: r.ok,
    parcial: r.parcial === true || cuentas.some((c) => c.parcial),
    motivo: r.motivo,
    error: errorCorto(r.error),
    itemsSynced: r.itemsSynced,
    categoriesSynced: r.categoriesSynced,
    ...(cuentas.length ? { cuentas } : {}),
  }
}

/** Un tenant falló o quedó parcial (la guarda frenó una baja) → el workflow tiene que avisar. */
export const hayProblema = (r: ResumenTenant) => !r.ok || r.parcial

/** Hubo al menos una cuenta bien sincronizada: el Shop tiene algo que revalidar. */
export const conCambios = (r: ResumenTenant) => r.ok || (r.cuentas ?? []).some((c) => c.ok)

export interface ResultadoRunner {
  resumenes: ResumenTenant[]
  exitCode: 0 | 1
}

/** Cada cuántos ítems leídos de la principal se imprime una línea de avance. */
export const CADA_ITEMS_LOG = 1500

const nombreCuenta = (cuenta: string) => (cuenta === "principal" ? "cuenta principal" : `cuenta ${cuenta}`)

/**
 * Observador de avance que imprime líneas para el log del runner ("central-led · cuenta principal:
 * 6.000 ítems leídos"). Solo conteos y slugs: sin credenciales ni detalle de Alegra.
 */
export function logDeProgreso(
  tenant: string,
  log: (linea: string) => void = console.log,
): (e: EventoProgreso) => void {
  let proximo = CADA_ITEMS_LOG
  const n = (v: number) => v.toLocaleString("es-AR")
  return (e) => {
    if (e.tipo === "cuenta-inicio") {
      proximo = CADA_ITEMS_LOG
      log(`${tenant} · ${nombreCuenta(e.cuenta)}: empieza`)
    } else if (e.tipo === "lectura") {
      if (e.leidos < proximo) return
      log(`${tenant} · ${nombreCuenta(e.cuenta)}: ${n(e.leidos)} ítems leídos`)
      proximo = (Math.floor(e.leidos / CADA_ITEMS_LOG) + 1) * CADA_ITEMS_LOG
    } else {
      log(`${tenant} · ${nombreCuenta(e.cuenta)}: ${e.ok ? "terminó" : "falló"} (${n(e.itemsSynced)} ítems)`)
    }
  }
}

/** Sincroniza COMPLETAS (principal + secundarias) las cuentas de cada tenant, de a uno. */
export async function correrSync(
  configs: TenantConfig[],
  opts: { aceptarBaja?: boolean; log?: (linea: string) => void } = {},
): Promise<ResultadoRunner> {
  const resumenes: ResumenTenant[] = []
  for (const cfg of configs) {
    let r: SyncTenantResult
    const onProgreso = logDeProgreso(cfg.id, opts.log)
    try {
      r = await syncTenant(cfg, "cron", { aceptarBaja: opts.aceptarBaja, onProgreso })
      for (let v = 1; r.continuar && v < MAX_VUELTAS; v++) {
        r = await syncTenant(cfg, "cron", { aceptarBaja: opts.aceptarBaja, onProgreso })
      }
      if (r.continuar) r = { ok: false, itemsSynced: r.itemsSynced, categoriesSynced: r.categoriesSynced, error: "sync_incompleta" }
    } catch (err) {
      console.error(`[alegra-sync] tenant=${cfg.id} error: ${err instanceof Error ? err.name : "error"}`)
      r = { ok: false, itemsSynced: 0, categoriesSynced: 0, error: "sync_failed" }
    }
    resumenes.push(resumir(cfg.id, r))
  }
  return { resumenes, exitCode: resumenes.some(hayProblema) ? 1 : 0 }
}
