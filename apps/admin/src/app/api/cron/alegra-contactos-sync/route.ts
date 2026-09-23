import { getDb } from "@/db"
import { tenants as tenantsTable } from "@/db/schema"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"
import { syncContacts, type ContactsSyncResult } from "@/lib/alegra-contacts-sync"
import { bearerMatches } from "@/lib/secure-compare"

// Sync del espejo de contactos de Alegra (tabla alegra_contacts) para todos los tenants con
// Alegra, o solo para `?tenant=<id>`. La dispara el workflow admin-alegra-contactos-sync de
// GitHub Actions con CRON_SECRET. Best-effort por tenant, como /api/cron/alegra-sync.
//
// Cada invocación corre UN tramo por tenant (ver lib/alegra-contacts-sync.ts): a lo sumo 3
// páginas, unos segundos. La respuesta dice por tenant si la pasada terminó (`done`) o si hay
// que volver a llamar; el workflow repite cada ~60 s mientras quede alguno pendiente.
export const maxDuration = 60

/** 45 s: un tramo tarda ~10 s; el margen contra maxDuration es para cerrar la bitácora. */
const DEADLINE_MS = 45_000

type ResultadoTenant = { tenant: string } & ContactsSyncResult

async function tenantsConAlegra(soloTenant: string | null): Promise<TenantConfig[]> {
  const ids = soloTenant ? [soloTenant] : (await getDb().select({ id: tenantsTable.id }).from(tenantsTable)).map((r) => r.id)
  const configs: TenantConfig[] = []
  for (const id of ids) {
    const cfg = await getTenantByIdFromDb(id)
    // Sin Alegra configurado (ni mock ni token) → no hay padrón que espejar.
    if (cfg && (cfg.alegraMock || cfg.alegraToken)) configs.push(cfg)
  }
  return configs
}

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const deadline = Date.now() + DEADLINE_MS

  const url = new URL(req.url)
  const soloTenant = url.searchParams.get("tenant")?.trim() || null
  // Disparo a mano: el workflow_dispatch manda trigger=manual. Un `?tenant=` suelto (curl a
  // mano) cuenta como manual; el workflow, al seguir un tenant pendiente, manda su trigger.
  // Solo importa al ABRIR una pasada: los tramos siguientes no lo cambian.
  const param = url.searchParams.get("trigger")
  const trigger = param === "manual" || param === "cron" ? param : soloTenant ? "manual" : "cron"

  try {
    const configs = await tenantsConAlegra(soloTenant)
    if (soloTenant && configs.length === 0) {
      return Response.json({ error: "tenant_sin_alegra" }, { status: 404 })
    }
    const results: ResultadoTenant[] = []
    for (const cfg of configs) {
      try {
        results.push({ tenant: cfg.id, ...(await syncContacts(cfg, trigger, { deadline })) })
      } catch {
        // syncContacts no tira; si algo igual se escapa (la base), el resto sigue.
        results.push({
          tenant: cfg.id,
          ok: false,
          done: true,
          contactsSynced: 0,
          totalPasada: 0,
          markedInactive: 0,
          requests: 0,
          error: "error_interno",
        })
      }
    }
    return Response.json({ tenants: results })
  } catch (err) {
    console.error("cron/alegra-contactos-sync error:", err instanceof Error ? err.name : "desconocido")
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}

// Mismo handler por GET, como /api/cron/alegra-sync.
export const GET = POST
