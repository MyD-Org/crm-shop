import { avisarShop } from "@/lib/aviso-shop"
import { tenantsConAlegra } from "@/lib/alegra-sync-tenants"
import { bearerMatches } from "@/lib/secure-compare"

// Efectos posteriores a la sync programada del catálogo. La sync corre en el runner de GitHub
// Actions (scripts/alegra-sync.ts), que no tiene el caché de Next ni las credenciales del Shop:
// al terminar, el workflow llama acá (con CRON_SECRET) una vez por tenant sincronizado. Sólo hace
// el aviso al Shop (ping de revalidación + registro de frescura) y responde rápido; no sincroniza.

const ID_TENANT = /^[A-Za-z0-9_-]+$/

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const tenant = new URL(req.url).searchParams.get("tenant")?.trim() ?? ""
  if (!ID_TENANT.test(tenant)) {
    return Response.json({ error: "Indique el tenant (solo letras, números, guiones y guiones bajos)." }, { status: 400 })
  }
  try {
    if ((await tenantsConAlegra(tenant)).length === 0) {
      return Response.json({ error: "Tenant inexistente o sin Alegra configurado." }, { status: 404 })
    }
    const { propagado } = await avisarShop(tenant)
    return Response.json({ ok: true, tenant, propagado })
  } catch (err) {
    console.error("cron/alegra-sync/post-sync error:", err instanceof Error ? err.name : "error")
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}
