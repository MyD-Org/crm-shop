import { after } from "next/server"
import { getTenantByIdFromDb } from "@/lib/tenants"
import { esEventoStock, registrarAviso, tokenWebhookStockValido } from "@/lib/alegra-stock-webhook"
import { drenarTenant } from "@/lib/alegra-stock-cola"
import { leerCuerpo, loguearClavesUnaVez, motivoError } from "@/lib/alegra-webhook-comun"

// POST /api/webhooks/alegra/stock/<tenant>/<evento>/<token>
//
// Avisos de Alegra sobre facturas, compras e ítems (9 eventos, ver EVENTOS_STOCK) → cola de
// re-lectura de ítems. Una suscripción por evento, creada con scripts/alegra-webhooks-stock.ts.
// Ver lib/alegra-stock-webhook.ts y lib/alegra-stock-cola.ts.
//
// - Auth: `token` = HMAC del tenant con ALEGRA_WEBHOOK_SECRET (dominio `alegra-stock`, distinto
//   del de contactos), comparado en tiempo constante. El tenant sale del PATH.
// - ANTES de responder, el aviso se registra en la base (índice documento→ítems + cola): si la
//   función muere después, el cron de drenaje lo barre igual. Si la base falla → 500.
// - DESPUÉS (`after`): espera unos segundos para juntar ráfagas y drena la cola del tenant con
//   GET /items/{id} a ritmo fijo. La respuesta nunca espera a Alegra.
// - Logs: tenant, evento, id del documento, acción y conteos. Nunca el cuerpo (las facturas
//   traen datos de clientes), montos ni el token.

// El trabajo que corre en `after` usa este mismo tope.
export const maxDuration = 60

/** Espera antes de drenar: junta los avisos de una ráfaga en una sola lectura por ítem. */
const DEBOUNCE_MS = 5_000
/** Presupuesto del drenaje, contado desde que llegó el aviso (margen contra maxDuration). */
const PRESUPUESTO_MS = 45_000

type Params = { tenant: string; evento: string; token: string }

async function autorizado(p: Params) {
  if (!esEventoStock(p.evento)) return null
  if (!tokenWebhookStockValido(p.tenant, p.token)) return null
  const config = await getTenantByIdFromDb(p.tenant)
  if (!config || !(config.alegraMock || config.alegraToken)) return null
  return { config, evento: p.evento }
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
  // Mismo 404 para token inválido, evento o tenant desconocido: no se confirma qué existe.
  if (!auth) return Response.json({ error: "not_found" }, { status: 404 })
  const { config, evento } = auth

  const payload = await leerCuerpo(req)
  loguearClavesUnaVez("[alegra-stock]", config.id, evento, payload)

  let r: Awaited<ReturnType<typeof registrarAviso>>
  try {
    r = await registrarAviso(config.id, evento, payload)
  } catch (err) {
    console.error(`[alegra-stock] tenant=${config.id} evento=${evento} accion=error error=${motivoError(err)}`)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }

  const linea = `[alegra-stock] tenant=${config.id} evento=${evento} doc=${r.docId ?? "-"} accion=${r.accion} items=${r.items} encolados=${r.encolados}`
  if (r.accion === "sin_id" || r.accion === "sin_indice") console.warn(linea)
  else console.log(linea)

  if (r.encolados > 0) {
    after(async () => {
      await dormir(DEBOUNCE_MS)
      try {
        await drenarTenant(config, { deadline: inicio + PRESUPUESTO_MS })
      } catch (err) {
        // Lo que quedó en la cola lo barre el cron de drenaje.
        console.error(`[alegra-stock/drenar] tenant=${config.id} error=${motivoError(err)}`)
      }
    })
  }

  return Response.json({ ok: true })
}

/** Para probar la URL a mano (o por si Alegra la verifica con un GET): no toca nada. */
export async function GET(_req: Request, ctx: { params: Promise<Params> }) {
  try {
    const auth = await autorizado(await ctx.params)
    if (!auth) return Response.json({ error: "not_found" }, { status: 404 })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}
