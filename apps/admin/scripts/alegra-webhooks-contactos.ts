/**
 * Suscripciones de webhooks de CONTACTOS de un tenant en su cuenta de Alegra: crear, listar o
 * borrar las tres (new-client, edit-client, delete-client) que apuntan a
 * /api/webhooks/alegra/contactos/<tenant>/<evento>/<token> del CRM.
 *
 * OJO: crear y borrar cambian la configuración de la cuenta REAL del cliente en Alegra (no hay
 * sandbox). El script muestra qué va a hacer y pide escribir SI antes de tocar nada. `listar`
 * solo lee.
 *
 *   CRM_DATABASE_URL="<conexión de prod>" ALEGRA_WEBHOOK_SECRET="<el mismo de Vercel>" \
 *     npx tsx --env-file-if-exists=.env.local scripts/alegra-webhooks-contactos.ts \
 *     --tenant <tenant-id> --base-url https://<tenant>.plataforma.example crear
 *
 * - Las credenciales de Alegra salen de la fila del tenant (tabla `tenants`), como en el resto
 *   del CRM; nunca se imprimen.
 * - ALEGRA_WEBHOOK_SECRET tiene que ser EXACTAMENTE el de producción: el token de la URL se
 *   deriva de él (HMAC por tenant). Si no coincide, los avisos llegan y se rechazan con 404.
 * - --base-url: el origen público del CRM que responde para ese tenant (su subdominio). Sin
 *   barra final. Solo se usa para armar la URL que se registra en Alegra.
 * - CRM_DATABASE_URL manda sobre DATABASE_URL (ver scripts/set-tenant-alegra.ts: --env-file no
 *   pisa una variable ya exportada en el shell).
 * - El token es un secreto: en pantalla se muestra enmascarado.
 *
 * Cuenta SECUNDARIA (p. ej. la de Mar del Plata): agregar `--cuenta <slug>`. Registra/lista/borra
 * los tres avisos de ESA cuenta, que apuntan a
 * /api/webhooks/alegra/contactos-cuenta/<id de la cuenta>/<evento>/<token>, con las credenciales de
 * la cuenta (tabla `alegra_cuentas`). Con `--cuenta` solo se reconocen como propias las
 * suscripciones de esa cuenta: las de la principal no se listan ni se borran, y al revés.
 *
 *   ... scripts/alegra-webhooks-contactos.ts --tenant <id> --cuenta mdp \
 *     --base-url https://<tenant>.plataforma.example crear
 *
 * IMPORTANTE (cuenta nueva): crear los avisos DESPUÉS de desplegar la ruta
 * `contactos-cuenta`. Alegra valida la URL al registrarla y rechaza las que dan 404 ("La URL
 * ingresada no es válida"). ALEGRA_WEBHOOK_SECRET es Sensitive en Vercel (`vercel env pull` no lo
 * baja): hay que pasarlo por el entorno al correr el script, con el mismo valor de producción.
 */
import { createInterface } from "node:readline/promises"
import { and, eq } from "drizzle-orm"
import { getDb } from "../src/db"
import { alegraCuentas } from "../src/db/schema"
import { configParaCuenta } from "../src/lib/sucursales-cuenta"
import {
  AlegraHttpError,
  AlegraRateLimitError,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
  type AlegraWebhookSubscription,
} from "../src/lib/alegra"
import {
  EVENTOS_CONTACTOS,
  esSuscripcionContactos,
  esSuscripcionContactosCuenta,
  enmascararUrlContactosCuenta,
  rutaWebhookContactos,
  rutaWebhookContactosCuenta,
  tokenWebhookContactos,
  tokenWebhookContactosCuenta,
} from "../src/lib/alegra-contacts-webhook"
import { getTenantByIdFromDb } from "../src/lib/tenants"

if (process.env.CRM_DATABASE_URL) process.env.DATABASE_URL = process.env.CRM_DATABASE_URL

type Accion = "crear" | "listar" | "borrar"

function argumentos() {
  const args = process.argv.slice(2)
  const valor = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const accion = args.find((a) => a === "crear" || a === "listar" || a === "borrar") as Accion | undefined
  return { tenant: valor("--tenant")?.trim(), cuenta: valor("--cuenta")?.trim(), baseUrl: valor("--base-url")?.trim().replace(/\/+$/, ""), accion }
}

/** La URL con el token tapado: alcanza para reconocerla sin filtrar el secreto. */
function enmascarar(url: string): string {
  return url.replace(/(\/api\/webhooks\/alegra\/contactos\/[^/]+\/[^/]+\/)([^/?#]+)/, (_, pre: string, tok: string) =>
    `${pre}${tok.slice(0, 4)}…`,
  )
}

const esNuestra = (tenant: string) => (s: AlegraWebhookSubscription) => esSuscripcionContactos(tenant, s)

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(`${pregunta} Escriba SI para continuar: `)).trim() === "SI"
  } finally {
    rl.close()
  }
}

async function main() {
  const { tenant, cuenta: slugCuenta, baseUrl, accion } = argumentos()
  if (!tenant || !accion || (accion !== "listar" && !baseUrl)) {
    console.error("Uso: ... scripts/alegra-webhooks-contactos.ts --tenant <id> [--cuenta <slug>] --base-url <https://…> crear|listar|borrar")
    console.error("(--base-url no hace falta para listar)")
    process.exitCode = 1
    return
  }
  if (baseUrl && !/^https:\/\/[^/]+$/.test(baseUrl)) {
    console.error("--base-url tiene que ser un origen https sin ruta, p. ej. https://empresa.plataforma.example")
    process.exitCode = 1
    return
  }

  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "")
  console.log(`base del CRM: ${host || "???"}  (${/localhost|127\.0\.0\.1/.test(host) ? "LOCAL" : "REMOTA"})`)

  const base = await getTenantByIdFromDb(tenant)
  if (!base) {
    console.error(`No existe el tenant "${tenant}".`)
    process.exitCode = 1
    return
  }

  // Con --cuenta: la cuenta secundaria (id, credenciales y URLs propias). Sin --cuenta: la principal.
  let config = base
  let cuentaId: string | null = null
  if (slugCuenta) {
    const [fila] = await getDb()
      .select()
      .from(alegraCuentas)
      .where(and(eq(alegraCuentas.tenantId, tenant), eq(alegraCuentas.slug, slugCuenta), eq(alegraCuentas.principal, false)))
    if (!fila) {
      console.error(`El tenant "${tenant}" no tiene una cuenta secundaria "${slugCuenta}". La principal se opera sin --cuenta.`)
      process.exitCode = 1
      return
    }
    try {
      config = configParaCuenta(base, {
        slug: fila.slug,
        principal: false,
        alegraEmail: fila.alegraEmail,
        alegraToken: fila.alegraToken,
        alegraMock: fila.alegraMock,
      })
    } catch {
      console.error(`La cuenta "${slugCuenta}" del tenant "${tenant}" no tiene credenciales de Alegra cargadas.`)
      process.exitCode = 1
      return
    }
    cuentaId = fila.id
  }
  if (config.alegraMock || !config.alegraToken) {
    console.error(`${slugCuenta ? `La cuenta "${slugCuenta}" del tenant "${tenant}"` : `El tenant "${tenant}"`} no tiene una cuenta real de Alegra configurada (mock o sin token).`)
    process.exitCode = 1
    return
  }
  console.log(`tenant:       ${tenant}${slugCuenta ? `  cuenta: ${slugCuenta}` : ""}  (credenciales de Alegra: cargadas)\n`)

  const propia = (s: AlegraWebhookSubscription) => (cuentaId ? esSuscripcionContactosCuenta(cuentaId, s) : esNuestra(tenant)(s))
  const mostrar = (url: string) => (cuentaId ? enmascararUrlContactosCuenta(url) : enmascarar(url))
  const actuales = (await listWebhookSubscriptions(config)).filter(propia)

  if (accion === "listar") {
    if (actuales.length === 0) console.log(`No hay suscripciones de contactos de ${slugCuenta ? "esta cuenta" : "este tenant"}.`)
    for (const s of actuales) console.log(`- ${s.event.padEnd(14)} id=${s.id}  ${mostrar(s.url)}`)
    return
  }

  if (accion === "borrar") {
    if (actuales.length === 0) {
      console.log("No hay suscripciones de contactos para borrar.")
      return
    }
    console.log("Se van a BORRAR en Alegra:")
    for (const s of actuales) console.log(`- ${s.event.padEnd(14)} id=${s.id}  ${mostrar(s.url)}`)
    if (!(await confirmar("\n¿Borrar estas suscripciones?"))) return console.log("Cancelado. No se tocó nada.")
    for (const s of actuales) {
      await deleteWebhookSubscription(config, s.id)
      console.log(`borrada: ${s.event} (id=${s.id})`)
    }
    return
  }

  // crear
  const token = cuentaId ? tokenWebhookContactosCuenta(cuentaId) : tokenWebhookContactos(tenant)
  if (!token) {
    console.error("Falta ALEGRA_WEBHOOK_SECRET (32 caracteres o más, el MISMO que en Vercel).")
    process.exitCode = 1
    return
  }
  const plan = EVENTOS_CONTACTOS.map((event) => ({
    event,
    url: `${baseUrl}${cuentaId ? rutaWebhookContactosCuenta(cuentaId, event, token) : rutaWebhookContactos(tenant, event, token)}`,
  }))
  const faltan = plan.filter((p) => !actuales.some((s) => s.event === p.event && s.url === p.url))
  const viejas = actuales.filter((s) => !plan.some((p) => p.event === s.event && p.url === s.url))

  for (const p of plan.filter((p) => !faltan.includes(p))) console.log(`ya existe: ${p.event}`)
  if (viejas.length > 0) {
    console.log("\nHay suscripciones de este tenant con OTRA url (otro host o secreto viejo). No se tocan;")
    console.log("si sobran, bórrelas con `borrar` y vuelva a crear:")
    for (const s of viejas) console.log(`- ${s.event.padEnd(14)} id=${s.id}  ${mostrar(s.url)}`)
  }
  if (faltan.length === 0) return console.log("\nNada que crear.")

  console.log("\nSe van a CREAR en Alegra:")
  for (const p of faltan) console.log(`- ${p.event.padEnd(14)} ${mostrar(p.url)}`)
  if (!(await confirmar("\n¿Crear estas suscripciones?"))) return console.log("Cancelado. No se tocó nada.")
  for (const p of faltan) {
    const s = await createWebhookSubscription(config, p.event, p.url)
    console.log(`creada: ${p.event}${s.id ? ` (id=${s.id})` : ""}`)
  }
  console.log(`\nListo. Edite un contacto de prueba en Alegra y busque en los logs de Vercel \`${cuentaId ? "[alegra-contactos-cuenta]" : "[webhooks/alegra]"}\`.`)
}

main()
  .catch((err) => {
    // El detalle de /webhooks/subscriptions es de configuración (p. ej. "url inválida"), no de
    // contactos: se muestra para poder corregir. Cualquier otro error, solo el tipo.
    if (err instanceof AlegraHttpError || err instanceof AlegraRateLimitError) console.error(`Falló: ${err.message}`)
    else console.error(`Falló: ${err instanceof Error ? err.name : "error"}`)
    process.exitCode = 1
  })
  .then(() => process.exit())
