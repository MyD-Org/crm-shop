import { getDb } from "@/db"
import { tenants as tenantsTable } from "@/db/schema"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"
import { syncCatalog, type SyncResult } from "@/lib/alegra-sync"
import { bearerMatches } from "@/lib/secure-compare"

// Sincroniza TODOS los tenants en una sola invocación: necesita más margen que la sync manual.
export const maxDuration = 300

// Sincroniza el catálogo de Alegra a la cache de todos los tenants con Alegra configurado, o
// sólo el de `?tenant=<id>`. Lo invoca el workflow admin-alegra-sync (o curl en dev) con
// CRON_SECRET. Best-effort por tenant. Ver ADR catálogo.
//
// `?aceptar_baja=1` (sólo junto con `?tenant=`): la corrida de ESE tenant acepta leer mucho menos
// que la última OK y da de baja lo no visto (salida del operador ante una baja masiva legítima;
// ver la guarda en lib/alegra-sync-guarda.ts). El botón manual del admin nunca lo pasa.

type ResultadoTenant = { tenant: string } & SyncResult

function conAlegra(cfg: TenantConfig | null): cfg is TenantConfig {
  // Sin Alegra configurado (ni mock ni token) → saltear.
  return !!cfg && (cfg.alegraMock || !!cfg.alegraToken)
}

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const soloTenant = url.searchParams.get("tenant")?.trim() || null
  const aceptarBaja = url.searchParams.get("aceptar_baja") === "1"
  if (aceptarBaja && !soloTenant) {
    return Response.json({ error: "aceptar_baja requiere indicar el tenant." }, { status: 400 })
  }

  try {
    const ids = soloTenant
      ? [soloTenant]
      : (await getDb().select({ id: tenantsTable.id }).from(tenantsTable)).map((r) => r.id)
    const configs: TenantConfig[] = []
    for (const id of ids) {
      const cfg = await getTenantByIdFromDb(id)
      if (conAlegra(cfg)) configs.push(cfg)
    }
    if (soloTenant && configs.length === 0) {
      return Response.json({ error: "Tenant inexistente o sin Alegra configurado." }, { status: 404 })
    }

    const results: ResultadoTenant[] = []
    for (const cfg of configs) {
      if (aceptarBaja) console.info(`[cron/alegra-sync] tenant=${cfg.id} aceptarBaja=1`)
      results.push({ tenant: cfg.id, ...(await syncCatalog(cfg, "cron", { aceptarBaja })) })
    }
    return Response.json({ tenants: results })
  } catch (err) {
    console.error("cron/alegra-sync error:", err)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}

// Vercel Cron usa GET
export const GET = POST
