import { and, asc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import { syncCatalog, type SyncResult } from "./alegra-sync"
import { syncCuentaSecundaria, type SyncCuentaResult } from "./alegra-sync-cuenta"

// Orquesta la sync de TODAS las cuentas de Alegra de un tenant (change `sucursales-igz-mdp`,
// rebanada D, design D3): primero la PRINCIPAL y después cada cuenta secundaria ACTIVA, en la
// misma invocación (y por lo tanto dentro del mismo grupo de concurrencia del workflow: la cuenta
// de Alegra topea a 150 req/min por usuario). El orden importa: la absorción de la principal va
// antes del alta de solo-secundaria. Una falla de una cuenta no frena a la otra. Sin cuentas
// secundarias activas es exactamente la sync de siempre.

export interface SyncTenantResult extends SyncResult {
  /** Resumen por cuenta secundaria; ausente si el tenant no tiene ninguna activa. */
  cuentas?: SyncCuentaResult[]
}

export async function syncTenant(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { aceptarBaja?: boolean } = {},
): Promise<SyncTenantResult> {
  const principal = await syncCatalog(config, trigger, opts)

  let secundarias: (typeof alegraCuentas.$inferSelect)[] = []
  try {
    secundarias = await getDb()
      .select()
      .from(alegraCuentas)
      .where(and(eq(alegraCuentas.tenantId, config.id), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
      .orderBy(asc(alegraCuentas.slug))
  } catch (err) {
    console.warn(`[alegra-sync-tenant] tenant=${config.id} no se pudieron leer las cuentas: ${err instanceof Error ? err.name : "error"}`)
  }
  if (secundarias.length === 0) return principal

  const cuentas: SyncCuentaResult[] = []
  for (const c of secundarias) {
    try {
      cuentas.push(await syncCuentaSecundaria(config, c, trigger, opts))
    } catch (err) {
      // syncCuentaSecundaria no debería lanzar (devuelve ok:false); por si falla la base.
      console.error(`[alegra-sync-tenant] tenant=${config.id} cuenta=${c.slug} error: ${err instanceof Error ? err.name : "error"}`)
      cuentas.push({ ok: false, cuenta: c.slug, itemsSynced: 0, categoriesSynced: 0, error: "sync_failed" })
    }
  }

  const fallidas = cuentas.filter((c) => !c.ok)
  if (fallidas.length === 0) return { ...principal, cuentas }
  return {
    ...principal,
    ok: false,
    error: principal.ok
      ? `No se pudo sincronizar la cuenta ${fallidas.map((c) => c.cuenta).join(", ")}.`
      : principal.error,
    cuentas,
  }
}
