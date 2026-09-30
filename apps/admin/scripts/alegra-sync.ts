/**
 * Sync COMPLETA del catálogo de Alegra, pensada para correr en el runner de GitHub Actions
 * (workflow admin-alegra-sync): sin el tope de 300 s de una función de Vercel, cada tenant
 * sincroniza su cuenta principal y las secundarias en un solo proceso.
 *
 *   DATABASE_URL="<conexión>" npx tsx scripts/alegra-sync.ts [--tenant <id>] [--aceptar-baja]
 *
 * - Sin --tenant: todos los tenants con Alegra. --aceptar-baja (requiere --tenant) acepta una
 *   baja masiva legítima que la guarda frenó (ver "Sync incompleta" en docs/FUNCIONALIDADES.md).
 * - Imprime un JSON por tenant con conteos y estado (nunca credenciales, host de la base ni el
 *   detalle crudo de errores de Alegra). Sale con código 1 si algún tenant falló o quedó parcial.
 * - Respeta la guarda de concurrencia (una corrida en curso o colgada se maneja igual que en la
 *   ruta por tramos) y retoma un cursor que haya dejado la ruta por tramos.
 * - No avisa al Shop: no tiene sus credenciales. Si GITHUB_OUTPUT está definido escribe
 *   `avisar=<ids>` con los tenants a avisar; el workflow llama luego a
 *   /api/cron/alegra-sync/post-sync.
 */
import { appendFileSync } from "node:fs"
import { getDb } from "../src/db"
import { desactivarAvisoShop } from "../src/lib/aviso-shop"
import { tenantsConAlegra } from "../src/lib/alegra-sync-tenants"
import { conCambios, correrSync, parsearArgs } from "../src/lib/alegra-sync-runner"

async function cerrarPool() {
  try {
    // El cliente postgres-js vive dentro del drizzle: se cierra para que el proceso termine.
    const client = (getDb() as unknown as { $client?: { end: (o?: { timeout?: number }) => Promise<void> } }).$client
    await client?.end({ timeout: 5 })
  } catch {
    /* nada que hacer al cerrar */
  }
}

async function main(): Promise<number> {
  const args = parsearArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(`::error::${args.error}`)
    return 1
  }
  if (!process.env.DATABASE_URL) {
    console.error("::error::Falta DATABASE_URL.")
    return 1
  }
  desactivarAvisoShop()

  const configs = await tenantsConAlegra(args.tenant)
  if (args.tenant && configs.length === 0) {
    console.error("::error::Tenant inexistente o sin Alegra configurado.")
    return 1
  }
  console.log(`Tenants con Alegra a sincronizar: ${configs.length}`)

  const { resumenes, exitCode } = await correrSync(configs, { aceptarBaja: args.aceptarBaja })
  for (const r of resumenes) {
    console.log(JSON.stringify(r))
    if (!r.ok) console.error(`::error::El tenant ${r.tenant} falló. Ver el resumen de arriba.`)
    else if (r.parcial) console.error(`::error::La sync de ${r.tenant} quedó incompleta: no se dio de baja ningún producto.`)
  }

  if (process.env.GITHUB_OUTPUT) {
    const avisar = resumenes.filter(conCambios).map((r) => r.tenant).join(" ")
    appendFileSync(process.env.GITHUB_OUTPUT, `avisar=${avisar}\n`)
  }
  return exitCode
}

main()
  .catch((err) => {
    console.error(`::error::La sync falló: ${err instanceof Error ? err.name : "error"}`)
    return 1
  })
  .then(async (code) => {
    await cerrarPool()
    process.exit(code)
  })
