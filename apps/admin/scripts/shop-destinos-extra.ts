/**
 * Alta / baja de un destino de Shop EXTRA de un tenant (`tenants.shop_destinos_extra`, 0099).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/shop-destinos-extra.ts alta <tenant> <etiqueta> <url> [urlInterna]
 *   npx tsx --env-file-if-exists=.env.local scripts/shop-destinos-extra.ts baja <tenant> <etiqueta>
 *   ... --aplicar     # sin este flag es dry-run: muestra la lista resultante y no escribe nada
 *
 * La lista resultante se valida con `parsearDestinosExtra` (la misma que usa el ping): si algún
 * ítem quedaría descartado (etiqueta reservada o repetida, URL no https o repetida, más de 4), el
 * script aborta sin escribir. El secreto del destino NO se guarda acá: hay que cargar la env
 * `SHOP_CRM_SECRET_<TENANT>__<ETIQUETA>` en el admin (y redeploy) para que el ping lo alcance.
 *
 * La base se elige con DATABASE_URL (sin ella, la local). Se muestra el host antes de escribir.
 */
import postgres from "postgres"
import { nombreSecretoExtra, parsearDestinosExtra, type DestinoExtra } from "../src/lib/shop-destino"

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const aplicar = process.argv.includes("--aplicar")
const [accion, tenantId, etiqueta, url, urlInterna] = args

if ((accion !== "alta" && accion !== "baja") || !tenantId || !etiqueta || (accion === "alta" && !url)) {
  console.error("uso: shop-destinos-extra.ts alta <tenant> <etiqueta> <url> [urlInterna] | baja <tenant> <etiqueta> [--aplicar]")
  process.exit(1)
}

const dbUrl = process.env.DATABASE_URL ?? "postgres://localhost:5432/crm"
const sql = postgres(dbUrl, { max: 1 })

async function main() {
  console.log(`Base: ${new URL(dbUrl).host}${aplicar ? "" : "  (DRY RUN)"}`)
  const [fila] = await sql<{ shop_url: string; shop_internal_url: string; shop_destinos_extra: unknown }[]>`
    SELECT shop_url, shop_internal_url, shop_destinos_extra FROM tenants WHERE id = ${tenantId}`
  if (!fila) throw new Error(`el tenant "${tenantId}" no existe`)
  if (!fila.shop_url.trim() && !fila.shop_internal_url.trim()) {
    throw new Error(`el tenant "${tenantId}" no tiene Shop principal propio: los extras se ignorarían`)
  }

  const actuales = parsearDestinosExtra(fila.shop_destinos_extra, [fila.shop_url, fila.shop_internal_url]).validos
  let nueva: unknown[]
  if (accion === "alta") {
    if (actuales.some((d) => d.etiqueta === etiqueta)) throw new Error(`la etiqueta "${etiqueta}" ya existe`)
    nueva = [...actuales, { etiqueta, url, ...(urlInterna ? { urlInterna } : {}) }]
  } else {
    if (!actuales.some((d) => d.etiqueta === etiqueta)) throw new Error(`la etiqueta "${etiqueta}" no existe`)
    nueva = actuales.filter((d) => d.etiqueta !== etiqueta)
  }

  const { validos, descartados } = parsearDestinosExtra(nueva, [fila.shop_url, fila.shop_internal_url])
  if (descartados.length > 0) throw new Error(`configuración inválida, quedarían descartados: ${descartados.join(", ")}`)

  const resumen = (l: DestinoExtra[]) => l.map((d) => `${d.etiqueta} → ${d.url}`).join("; ") || "(ninguno)"
  console.log(`Antes:   ${resumen(actuales)}`)
  console.log(`Después: ${resumen(validos)}`)
  if (accion === "alta") console.log(`Recordatorio: cargar la env ${nombreSecretoExtra(tenantId, etiqueta)} en el admin y redesplegar.`)

  if (!aplicar) {
    console.log("\nDry run: no se escribió nada. Repetir con --aplicar.")
    return
  }
  await sql`UPDATE tenants SET shop_destinos_extra = ${sql.json(validos as never)}, updated_at = now() WHERE id = ${tenantId}`
  console.log("\nListo.")
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
