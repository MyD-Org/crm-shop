import { getDb } from "@/db"
import { tenants as tenantsTable } from "@/db/schema"
import { getTenantByIdFromDb, type TenantConfig } from "@/lib/tenants"
import { PRESUPUESTO_TRAMO_MS, syncTenant, type SyncTenantResult } from "@/lib/alegra-sync-tenant"
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
//
// REANUDABLE POR TRAMOS: cada invocación procesa hasta ~220 s (PRESUPUESTO_TRAMO_MS) y, si el
// tenant no terminó (la principal de Central Led sola tarda ~5 min), guarda un cursor y responde
// `continuar: true` en ese tenant y en la raíz: quien dispara (el workflow) vuelve a llamar hasta
// que deje de venir. Con `?tenant=` se retoma ese tenant. Sin `?tenant=` se procesan los tenants
// en orden hasta el primero que necesite otro tramo (los siguientes quedan sin tocar): el
// workflow no usa ese modo, lista los tenants con `?listar=1` y los recorre de a uno.
//
// Multicuenta (change `sucursales-igz-mdp`): por cada tenant corre primero la cuenta principal y
// después cada cuenta secundaria activa (lib/alegra-sync-tenant.ts); el resumen de cada una viaja
// en `cuentas` (sólo si el tenant tiene secundarias). Una falla de una cuenta no frena a la otra.

type ResultadoTenant = { tenant: string } & SyncTenantResult

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

    // Sólo los ids de los tenants con Alegra: el workflow los recorre de a uno.
    if (url.searchParams.get("listar") === "1") {
      return Response.json({ tenants: configs.map((c) => c.id) })
    }

    const inicio = Date.now()
    const results: ResultadoTenant[] = []
    let continuar = false
    for (const cfg of configs) {
      if (aceptarBaja) console.info(`[cron/alegra-sync] tenant=${cfg.id} aceptarBaja=1`)
      // El presupuesto es de toda la invocación: cada tenant recibe lo que queda.
      const presupuestoMs = Math.max(0, PRESUPUESTO_TRAMO_MS - (Date.now() - inicio))
      if (results.length > 0 && presupuestoMs < PRESUPUESTO_TRAMO_MS / 2) {
        continuar = true
        break
      }
      const r = await syncTenant(cfg, "cron", { aceptarBaja, presupuestoMs })
      results.push({ tenant: cfg.id, ...r })
      if (r.continuar) {
        continuar = true
        break
      }
    }
    return Response.json({ tenants: results, continuar })
  } catch (err) {
    console.error("cron/alegra-sync error:", err)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}

// Vercel Cron usa GET
export const GET = POST
