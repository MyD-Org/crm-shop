import { getDb } from "@/db"
import { tenants as tenantsTable } from "@/db/schema"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"

// Tenants con Alegra configurado (mock o token): la fuente única de "a quién sincronizar" que
// comparten la ruta cron por tramos y el runner del workflow (scripts/alegra-sync.ts).

export function conAlegra(cfg: TenantConfig | null): cfg is TenantConfig {
  // Sin Alegra configurado (ni mock ni token) → saltear.
  return !!cfg && (cfg.alegraMock || !!cfg.alegraToken)
}

/** Config de los tenants con Alegra; con `soloTenant`, sólo ese (vacío si no existe o no tiene). */
export async function tenantsConAlegra(soloTenant?: string | null): Promise<TenantConfig[]> {
  const ids = soloTenant
    ? [soloTenant]
    : (await getDb().select({ id: tenantsTable.id }).from(tenantsTable)).map((r) => r.id)
  const configs: TenantConfig[] = []
  for (const id of ids) {
    const cfg = await getTenantByIdFromDb(id)
    if (conAlegra(cfg)) configs.push(cfg)
  }
  return configs
}
