/**
 * Suscripciones de webhooks de STOCK de un tenant en su cuenta de Alegra: crear, listar o
 * borrar las nueve (new/edit/delete de invoice, bill e item) que apuntan a
 * /api/webhooks/alegra/stock/<tenant>/<evento>/<token> del CRM. Prenderlas es lo que hace que
 * el espejo de productos se entere de una venta o una compra en minutos; borrarlas lo apaga (el
 * espejo vuelve a depender de la sync diaria).
 *
 * OJO: crear y borrar cambian la configuración de la cuenta REAL del cliente en Alegra (no hay
 * sandbox). El script muestra qué va a hacer y pide escribir SI antes de tocar nada. `listar`
 * solo lee.
 *
 *   CRM_DATABASE_URL="<conexión de prod>" ALEGRA_WEBHOOK_SECRET="<el mismo de Vercel>" \
 *     npx tsx --env-file-if-exists=.env.local scripts/alegra-webhooks-stock.ts \
 *     --tenant <tenant-id> --base-url https://<tenant>.plataforma.example crear
 *
 * - Las credenciales de Alegra salen de la fila del tenant (tabla `tenants`); nunca se imprimen.
 * - ALEGRA_WEBHOOK_SECRET tiene que ser EXACTAMENTE el de producción: el token de la URL se
 *   deriva de él (HMAC por tenant, dominio `alegra-stock`). Si no coincide, los avisos llegan y
 *   se rechazan con 404.
 * - --base-url: el origen público del CRM que responde para ese tenant. Sin barra final.
 * - CRM_DATABASE_URL manda sobre DATABASE_URL (--env-file no pisa una variable ya exportada).
 * - El token es un secreto: en pantalla se muestra enmascarado.
 * - `borrar` toca SOLO las suscripciones de stock de este tenant, nunca las de contactos.
 * - Si Alegra rechaza un evento al crear, lo informa y sigue con los demás.
 */
import { createInterface } from "node:readline/promises"
import {
  AlegraHttpError,
  AlegraRateLimitError,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
} from "../src/lib/alegra"
import {
  enmascararUrlStock,
  esSuscripcionStock,
  planSuscripcionesStock,
  tokenWebhookStock,
} from "../src/lib/alegra-stock-webhook"
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
  return { tenant: valor("--tenant")?.trim(), baseUrl: valor("--base-url")?.trim().replace(/\/+$/, ""), accion }
}

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(`${pregunta} Escriba SI para continuar: `)).trim() === "SI"
  } finally {
    rl.close()
  }
}

/** Motivo de un rechazo de Alegra: el detalle de /webhooks/subscriptions es de configuración. */
function motivo(err: unknown): string {
  if (err instanceof AlegraHttpError || err instanceof AlegraRateLimitError) return err.message
  return err instanceof Error ? err.name : "error"
}

async function main() {
  const { tenant, baseUrl, accion } = argumentos()
  if (!tenant || !accion || (accion === "crear" && !baseUrl)) {
    console.error("Uso: ... scripts/alegra-webhooks-stock.ts --tenant <id> --base-url <https://…> crear|listar|borrar")
    console.error("(--base-url sólo hace falta para crear; con él, listar marca las desactualizadas)")
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

  const config = await getTenantByIdFromDb(tenant)
  if (!config) {
    console.error(`No existe el tenant "${tenant}".`)
    process.exitCode = 1
    return
  }
  if (config.alegraMock || !config.alegraToken) {
    console.error(`El tenant "${tenant}" no tiene una cuenta real de Alegra configurada (mock o sin token).`)
    process.exitCode = 1
    return
  }
  console.log(`tenant:       ${tenant}  (credenciales de Alegra: cargadas)\n`)

  const todas = await listWebhookSubscriptions(config)
  const actuales = todas.filter((s) => esSuscripcionStock(tenant, s))
  const token = tokenWebhookStock(tenant)
  const plan = baseUrl && token ? planSuscripcionesStock(tenant, baseUrl, token, todas) : null
  const vieja = (id: string) => plan?.viejas.some((v) => v.id === id) ?? false

  if (accion === "listar") {
    if (actuales.length === 0) console.log("No hay suscripciones de stock de este tenant.")
    for (const s of actuales) {
      console.log(`- ${s.event.padEnd(15)} id=${s.id}  ${enmascararUrlStock(s.url)}${vieja(s.id) ? "  (DESACTUALIZADA)" : ""}`)
    }
    if (plan && plan.faltan.length > 0) console.log(`\nFaltan ${plan.faltan.length} de 9: ${plan.faltan.map((f) => f.event).join(", ")}`)
    return
  }

  if (accion === "borrar") {
    if (actuales.length === 0) {
      console.log("No hay suscripciones de stock de este tenant: nada que borrar.")
      return
    }
    console.log("Se van a BORRAR en Alegra (sólo las de stock; las de contactos no se tocan):")
    for (const s of actuales) console.log(`- ${s.event.padEnd(15)} id=${s.id}  ${enmascararUrlStock(s.url)}`)
    if (!(await confirmar("\n¿Borrar estas suscripciones?"))) return console.log("Cancelado. No se tocó nada.")
    for (const s of actuales) {
      await deleteWebhookSubscription(config, s.id)
      console.log(`borrada: ${s.event} (id=${s.id})`)
    }
    return
  }

  // crear
  if (!token || !plan) {
    console.error("Falta ALEGRA_WEBHOOK_SECRET (32 caracteres o más, el MISMO que en Vercel).")
    process.exitCode = 1
    return
  }
  for (const e of plan.vigentes) console.log(`ya existe: ${e}`)
  if (plan.viejas.length > 0) {
    console.log("\nHay suscripciones de stock de este tenant con OTRA url (otro host o secreto viejo). No se tocan;")
    console.log("si sobran, bórrelas con `borrar` y vuelva a crear:")
    for (const s of plan.viejas) console.log(`- ${s.event.padEnd(15)} id=${s.id}  ${enmascararUrlStock(s.url)}`)
  }
  if (plan.faltan.length === 0) return console.log("\nNada que crear.")

  console.log("\nSe van a CREAR en Alegra:")
  for (const p of plan.faltan) console.log(`- ${p.event.padEnd(15)} ${enmascararUrlStock(p.url)}`)
  if (!(await confirmar("\n¿Crear estas suscripciones?"))) return console.log("Cancelado. No se tocó nada.")
  const rechazadas: string[] = []
  for (const p of plan.faltan) {
    try {
      const s = await createWebhookSubscription(config, p.event, p.url)
      console.log(`creada: ${p.event}${s.id ? ` (id=${s.id})` : ""}`)
    } catch (err) {
      rechazadas.push(p.event)
      console.error(`Alegra rechazó ${p.event}: ${motivo(err)}`)
    }
  }
  if (rechazadas.length > 0) {
    console.error(`\nNo se crearon: ${rechazadas.join(", ")}. El resto quedó creado.`)
    process.exitCode = 1
  }
  console.log("\nListo. Haga una factura de prueba en Alegra y busque en los logs de Vercel `[alegra-stock]`.")
}

main()
  .catch((err) => {
    if (err instanceof AlegraHttpError || err instanceof AlegraRateLimitError) console.error(`Falló: ${err.message}`)
    else console.error(`Falló: ${err instanceof Error ? err.name : "error"}`)
    process.exitCode = 1
  })
  .then(() => process.exit())
