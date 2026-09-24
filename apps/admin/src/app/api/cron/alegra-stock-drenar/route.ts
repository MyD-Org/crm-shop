import { getTenantByIdFromDb } from "@/lib/tenants"
import { drenarTenant, purgarCola, tenantsParaDrenar, type ResultadoDrenaje } from "@/lib/alegra-stock-cola"
import { motivoError } from "@/lib/alegra-webhook-comun"
import { bearerMatches } from "@/lib/secure-compare"

// Red de la cola de re-lectura de stock (avisos de Alegra, ver lib/alegra-stock-cola.ts): drena
// lo que los `after` de la ruta de avisos no alcanzaron (tope, 429, función que murió) para
// todos los tenants con cola o con avisos, o sólo para `?tenant=<id>`. La dispara el workflow
// admin-alegra-stock-drenar de GitHub Actions cada 15 min con CRON_SECRET.
//
// También purga la cola vieja y el índice documento→ítems, y devuelve por tenant los minutos
// desde el último aviso: si pasa de un día, Alegra pudo haber desactivado las suscripciones.
export const maxDuration = 300

/** 270 s: margen contra maxDuration para soltar el lease y responder. */
const DEADLINE_MS = 270_000

type ResultadoTenant = { tenant: string; ok: boolean; error?: string } & ResultadoDrenaje & { ultimoAvisoMin: number | null }

const VACIO: ResultadoDrenaje = { leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia" }

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const deadline = Date.now() + DEADLINE_MS
  const soloTenant = new URL(req.url).searchParams.get("tenant")?.trim() || null

  try {
    const todos = await tenantsParaDrenar()
    const aMirar = soloTenant
      ? [todos.find((t) => t.tenant === soloTenant) ?? { tenant: soloTenant, ultimoAvisoMin: null }]
      : todos

    const results: ResultadoTenant[] = []
    for (const { tenant, ultimoAvisoMin } of aMirar) {
      const cfg = await getTenantByIdFromDb(tenant)
      // Sin Alegra configurado (ni mock ni token) no hay a quién preguntarle.
      if (!cfg || !(cfg.alegraMock || cfg.alegraToken)) continue
      try {
        results.push({ tenant, ok: true, ...(await drenarTenant(cfg, { deadline })), ultimoAvisoMin })
      } catch (err) {
        // drenarTenant sólo tira si falla la base: el resto de los tenants sigue.
        results.push({ tenant, ok: false, error: motivoError(err), ...VACIO, ultimoAvisoMin })
      }
    }

    try {
      await purgarCola({ colaHoras: 48, indiceDias: 400 })
    } catch (err) {
      console.error(`cron/alegra-stock-drenar purga error=${motivoError(err)}`)
    }
    return Response.json({ tenants: results })
  } catch (err) {
    console.error(`cron/alegra-stock-drenar error=${motivoError(err)}`)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}

// Mismo handler por GET, como /api/cron/alegra-sync.
export const GET = POST
