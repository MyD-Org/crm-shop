import { after } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas } from "@/db/schema"
import { getTenantByIdFromDb } from "@/lib/tenants"
import { configParaCuenta } from "@/lib/sucursales-cuenta"
import {
  esEventoContacto,
  loguearClavesUnaVez,
  procesarAvisoContacto,
  tokenWebhookContactosCuentaValido,
} from "@/lib/alegra-contacts-webhook"
import { leerCuerpo } from "@/lib/alegra-webhook-comun"

// POST /api/webhooks/alegra/contactos-cuenta/<cuentaId>/<evento>/<token>
//
// Avisos de Alegra sobre contactos (new-client, edit-client, delete-client) de una cuenta
// SECUNDARIA (change `espejo-contactos-por-cuenta`, rebanada A): la de una sucursal con cuenta
// propia (p. ej. Mar del Plata). Mismo mecanismo que la ruta de la principal (`../contactos/...`),
// pero el aviso se aplica con las credenciales de ESA cuenta y se escribe SOLO la fila de su
// espejo (`alegra_contacts.alegra_account = <slug>`). Ver lib/alegra-contacts-webhook.ts.
//
// - Auth: `token` = HMAC del id de la CUENTA (dominio `alegra-contactos-cuenta`); el tenant sale de
//   la fila de la cuenta, no del path. Un token de otra cuenta, el de la principal o el de stock da 404.
// - Suscripción: scripts/alegra-webhooks-contactos.ts --cuenta <slug> (paso manual, ver docs).
// - Responde 200 enseguida y aplica el aviso DESPUÉS (`after`). Si algo falla, queda en el log y lo
//   corrige la sync semanal.
// - Logs: tenant, cuenta, evento, acción e id. Nunca el cuerpo ni el token.

// El trabajo que corre en `after` usa este mismo tope.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { cuenta: string; evento: string; token: string }

async function autorizado(p: Params) {
  if (!esEventoContacto(p.evento)) return null
  if (!UUID_RE.test(p.cuenta)) return null
  if (!tokenWebhookContactosCuentaValido(p.cuenta, p.token)) return null
  const [cuenta] = await getDb()
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.id, p.cuenta), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
  if (!cuenta) return null
  const base = await getTenantByIdFromDb(cuenta.tenantId)
  if (!base) return null
  let config
  try {
    config = configParaCuenta(base, {
      slug: cuenta.slug,
      principal: false,
      alegraEmail: cuenta.alegraEmail,
      alegraToken: cuenta.alegraToken,
      alegraMock: cuenta.alegraMock,
    })
  } catch {
    // Sin credenciales no hay con qué leer el contacto: mismo 404 que cualquier otro rechazo.
    return null
  }
  return { config, slug: cuenta.slug, evento: p.evento }
}

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  const p = await ctx.params
  let auth: Awaited<ReturnType<typeof autorizado>>
  try {
    auth = await autorizado(p)
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
  // Mismo 404 para token inválido, evento, cuenta desconocida/inactiva/principal o sin credenciales:
  // no se confirma qué existe.
  if (!auth) return Response.json({ error: "not_found" }, { status: 404 })
  const { config, slug, evento } = auth

  const payload = await leerCuerpo(req)
  loguearClavesUnaVez(`${config.id}/${slug}`, evento, payload)

  after(async () => {
    const r = await procesarAvisoContacto(config, evento, payload, { cuenta: slug })
    const linea = `[alegra-contactos-cuenta] tenant=${config.id} cuenta=${slug} evento=${evento} accion=${r.accion} id=${r.id ?? "-"} requests=${r.requests}`
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
