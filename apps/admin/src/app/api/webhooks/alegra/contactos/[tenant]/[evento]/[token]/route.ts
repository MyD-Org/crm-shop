import { after } from "next/server"
import { getTenantByIdFromDb } from "@/lib/tenants"
import {
  esEventoContacto,
  loguearClavesUnaVez,
  procesarAvisoContacto,
  tokenWebhookValido,
} from "@/lib/alegra-contacts-webhook"

// POST /api/webhooks/alegra/contactos/<tenant>/<evento>/<token>
//
// Avisos de Alegra sobre contactos (new-client, edit-client, delete-client) → espejo de
// contactos. Una suscripción por evento, creada con scripts/alegra-webhooks-contactos.ts.
// Ver lib/alegra-contacts-webhook.ts.
//
// - Auth: `token` = HMAC del tenant con ALEGRA_WEBHOOK_SECRET, comparado en tiempo constante.
//   El tenant sale del PATH (el token lo ata a ese tenant), no del host.
// - Responde 200 enseguida y aplica el aviso DESPUÉS (`after`): 0 o 1 request a Alegra y un
//   upsert. Si algo falla, queda en el log y lo corrige la sync semanal.
// - Logs: tenant, evento, acción e id. Nunca el cuerpo.

// El trabajo que corre en `after` usa este mismo tope.
export const maxDuration = 60

type Params = { tenant: string; evento: string; token: string }

/** Cuerpo como JSON; si no lo es, como formulario (no se sabe cómo lo manda Alegra). */
async function leerCuerpo(req: Request): Promise<unknown> {
  const texto = await req.text().catch(() => "")
  if (!texto.trim()) return null
  try {
    return JSON.parse(texto)
  } catch {
    return Object.fromEntries(new URLSearchParams(texto))
  }
}

async function autorizado(p: Params) {
  if (!esEventoContacto(p.evento)) return null
  if (!tokenWebhookValido(p.tenant, p.token)) return null
  const config = await getTenantByIdFromDb(p.tenant)
  if (!config || !(config.alegraMock || config.alegraToken)) return null
  return { config, evento: p.evento }
}

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
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
  loguearClavesUnaVez(config.id, evento, payload)

  after(async () => {
    const r = await procesarAvisoContacto(config, evento, payload)
    const linea = `[webhooks/alegra] tenant=${config.id} evento=${evento} accion=${r.accion} id=${r.id ?? "-"} requests=${r.requests}`
    if (r.accion === "error") console.error(`${linea} error=${r.error}`)
    else if (r.accion === "sin_id") console.warn(linea)
    else console.log(linea)
  })

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
