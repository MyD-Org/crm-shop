import { getDb } from "@/db"
import { tenants as tenantsTable } from "@/db/schema"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"
import { syncContacts, type ContactsSyncResult } from "@/lib/alegra-contacts-sync"
import { ultimaOkPorTenant } from "@/lib/alegra-contacts-repo"
import { bearerMatches } from "@/lib/secure-compare"

// Sync del espejo de contactos de Alegra (tabla alegra_contacts) para todos los tenants con
// Alegra, o solo para `?tenant=<id>`. La dispara el workflow admin-alegra-contactos-sync de
// GitHub Actions con CRON_SECRET. Best-effort por tenant, como /api/cron/alegra-sync.
//
// Presupuesto: todos los tenants comparten `DEADLINE_MS` desde que arranca la invocación. El
// que se queda sin tiempo termina en 'sin_tiempo' SIN marcar bajas, y como los tenants se
// recorren por su última corrida OK más vieja primero, la próxima invocación arranca por él.
export const maxDuration = 300

/** 270 s: 30 s de margen contra maxDuration para cerrar bitácoras y responder. */
const DEADLINE_MS = 270_000

type ResultadoTenant = { tenant: string } & ContactsSyncResult

async function tenantsConAlegra(soloTenant: string | null): Promise<TenantConfig[]> {
  const ids = soloTenant ? [soloTenant] : (await getDb().select({ id: tenantsTable.id }).from(tenantsTable)).map((r) => r.id)
  const configs: TenantConfig[] = []
  for (const id of ids) {
    const cfg = await getTenantByIdFromDb(id)
    // Sin Alegra configurado (ni mock ni token) → no hay padrón que espejar.
    if (cfg && (cfg.alegraMock || cfg.alegraToken)) configs.push(cfg)
  }
  if (configs.length < 2) return configs
  const ultimas = await ultimaOkPorTenant()
  // Nunca sincronizado = el más viejo de todos.
  const cuando = (id: string) => ultimas.get(id)?.getTime() ?? 0
  return configs.sort((a, b) => cuando(a.id) - cuando(b.id))
}

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const deadline = Date.now() + DEADLINE_MS

  const url = new URL(req.url)
  const soloTenant = url.searchParams.get("tenant")?.trim() || null
  // Disparo a mano: un tenant puntual, o el workflow_dispatch (manda trigger=manual).
  const trigger = soloTenant || url.searchParams.get("trigger") === "manual" ? "manual" : "cron"

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
        results.push({ tenant: cfg.id, ok: false, contactsSynced: 0, markedInactive: 0, requests: 0, error: "error_interno" })
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
