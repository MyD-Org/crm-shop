import { after } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas } from "@/db/schema"
import { getTenantByIdFromDb } from "@/lib/tenants"
import { esEventoStock, registrarAviso, tokenWebhookStockCuentaValido } from "@/lib/alegra-stock-webhook"
import { drenarTenant } from "@/lib/alegra-stock-cola"
import { leerCuerpo, loguearClavesUnaVez, motivoError } from "@/lib/alegra-webhook-comun"

// POST /api/webhooks/alegra/stock-cuenta/<cuentaId>/<evento>/<token>
//
// Avisos de Alegra de una cuenta SECUNDARIA (change `sucursales-igz-mdp`, D2): la de una sucursal
// con cuenta propia (p. ej. Mar del Plata). Mismo mecanismo que la ruta de la principal
// (`../stock/...`): el aviso es sólo un disparador que encola los ítems tocados y un drenador los
// re-lee, pero acá los ítems se guardan con el prefijo `<slug>:` y se leen con las credenciales de
// ESA cuenta; lo pareado actualiza sólo el stock de la sucursal y lo solo-secundaria su fila propia.
//
// - Auth: `token` = HMAC del id de la CUENTA (dominio `alegra-stock-cuenta`); el tenant sale de la
//   fila de la cuenta, no del path. Un token de otra cuenta o el de la principal da 404.
// - Suscripción: scripts/alegra-webhooks-stock.ts --cuenta <slug> (paso manual, ver docs).
// - Logs: tenant, cuenta, evento y conteos. Nunca el cuerpo ni el token.

export const maxDuration = 60

const DEBOUNCE_MS = 5_000
const PRESUPUESTO_MS = 45_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { cuenta: string; evento: string; token: string }

async function autorizado(p: Params) {
  if (!esEventoStock(p.evento)) return null
  if (!UUID_RE.test(p.cuenta)) return null
  if (!tokenWebhookStockCuentaValido(p.cuenta, p.token)) return null
  const [cuenta] = await getDb()
    .select({ id: alegraCuentas.id, tenantId: alegraCuentas.tenantId, slug: alegraCuentas.slug })
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.id, p.cuenta), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
  if (!cuenta) return null
  const config = await getTenantByIdFromDb(cuenta.tenantId)
  if (!config) return null
  return { config, cuenta, evento: p.evento }
}

function dormir(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  const inicio = Date.now()
  const p = await ctx.params
  let auth: Awaited<ReturnType<typeof autorizado>>
  try {
    auth = await autorizado(p)
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
  // Mismo 404 para token inválido, evento o cuenta desconocida: no se confirma qué existe.
  if (!auth) return Response.json({ error: "not_found" }, { status: 404 })
  const { config, cuenta, evento } = auth

  const payload = await leerCuerpo(req)
  loguearClavesUnaVez("[alegra-stock-cuenta]", `${config.id}/${cuenta.slug}`, evento, payload)

  let r: Awaited<ReturnType<typeof registrarAviso>>
  try {
    r = await registrarAviso(config.id, evento, payload, cuenta.slug)
  } catch (err) {
    console.error(`[alegra-stock-cuenta] tenant=${config.id} cuenta=${cuenta.slug} evento=${evento} accion=error error=${motivoError(err)}`)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }

  const linea = `[alegra-stock-cuenta] tenant=${config.id} cuenta=${cuenta.slug} evento=${evento} accion=${r.accion} items=${r.items} encolados=${r.encolados}`
  if (r.accion === "sin_id" || r.accion === "sin_indice") console.warn(linea)
  else console.log(linea)

  if (r.encolados > 0) {
    after(async () => {
      await dormir(DEBOUNCE_MS)
      try {
        await drenarTenant(config, { deadline: inicio + PRESUPUESTO_MS })
      } catch (err) {
        // Lo que quedó en la cola lo barre el cron de drenaje.
        console.error(`[alegra-stock-cuenta/drenar] tenant=${config.id} cuenta=${cuenta.slug} error=${motivoError(err)}`)
      }
    })
  }

  return Response.json({ ok: true })
}

/** Para probar la URL a mano (o si Alegra la verifica con un GET): no toca nada. */
export async function GET(_req: Request, ctx: { params: Promise<Params> }) {
  try {
    const auth = await autorizado(await ctx.params)
    if (!auth) return Response.json({ error: "not_found" }, { status: 404 })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}
