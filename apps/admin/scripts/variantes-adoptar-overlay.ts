/**
 * Adopción del overlay por el ancla de cada modelo (change `variantes-de-producto`, S4 4.9).
 *
 * Con el selector de la tienda prendido, el overlay de un modelo (nombre, categoría, fotos, ficha,
 * visibilidad, etiquetas) es el de su ANCLA —el padre de Alegra, o la base de un grupo armado a mano—.
 * Hoy lo cargado está en cada variante. Este script copia el overlay de la variante que da la cara
 * del modelo (el representante) al ancla, SOLO si el ancla no tiene uno: nunca pisa un overlay
 * existente, y deja los overlays de las variantes como están. Lista los modelos en los que ningún
 * miembro tiene overlay: con el flag prendido saldrían invisibles (fail-closed) hasta que se carguen.
 *
 * Correr ANTES de prender el flag `variantes-selector`, después de `variantes-recalcular --ejecutar`
 * (el representante tiene que estar calculado).
 *
 * POR DEFECTO ES UN ENSAYO (dry-run): corre todo dentro de una transacción y la DESHACE (ROLLBACK);
 * informa cuántos overlays se copiarían. Con --ejecutar escribe de verdad. Imprime conteos y los ids
 * de Alegra de los modelos sin overlay (nunca nombres ni códigos).
 *
 *   DATABASE_URL="<conexión>" npx tsx scripts/variantes-adoptar-overlay.ts --tenant <id>
 *   DATABASE_URL="<conexión>" npx tsx scripts/variantes-adoptar-overlay.ts --tenant <id> --ejecutar
 *
 * Con --ejecutar sobre un host que no es local exige `--confirmar-host <host>`. Es idempotente:
 * correrlo de nuevo no copia nada más.
 */
import { getDb } from "../src/db"
import { adoptarOverlayEnAnclas, type ResultadoAdopcion } from "../src/lib/catalogo-variantes-repo"

const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}
const tenant = flag("--tenant")
const ejecutar = args.includes("--ejecutar")
if (!tenant) {
  console.error("Falta --tenant <id>.")
  process.exit(1)
}
const url = process.env.DATABASE_URL
if (!url) {
  console.error("Falta DATABASE_URL.")
  process.exit(1)
}
const host = new URL(url).hostname
console.log(`Base: ${new URL(url).host}  ·  tenant: ${tenant}  ·  modo: ${ejecutar ? "EJECUTAR" : "ensayo (se deshace)"}`)
const esLocal = host === "localhost" || host === "127.0.0.1" || host === "::1"
if (ejecutar && !esLocal && flag("--confirmar-host") !== host) {
  console.error(`Con --ejecutar sobre un host remoto indique --confirmar-host ${host}.`)
  process.exit(1)
}

class Ensayo extends Error {}

async function main(): Promise<void> {
  const db = getDb()
  let resultado: ResultadoAdopcion | null = null
  try {
    await db.transaction(async (tx) => {
      resultado = await adoptarOverlayEnAnclas(tenant as string, tx)
      if (!ejecutar) throw new Ensayo()
    })
  } catch (e) {
    if (!(e instanceof Ensayo)) throw e
  }
  const r = resultado as ResultadoAdopcion | null
  console.log(`Modelos: ${r?.grupos ?? 0}`)
  console.log(`  ya tenían overlay en el ancla (no se tocan): ${r?.conOverlay ?? 0}`)
  console.log(`  overlays ${ejecutar ? "copiados" : "que se copiarían"} desde el representante: ${r?.copiados ?? 0}`)
  console.log(`  sin overlay en ningún miembro (saldrían invisibles): ${r?.sinOverlayTotal ?? 0}`)
  if (r && r.sinOverlay.length > 0) {
    console.log(`  ids de Alegra del ancla${r.sinOverlayTotal > r.sinOverlay.length ? ` (primeros ${r.sinOverlay.length})` : ""}:`)
    console.log(`    ${r.sinOverlay.join(", ")}`)
  }
  if (!ejecutar) console.log("Ensayo: no se escribió nada. Use --ejecutar para aplicar.")
  const client = (db as unknown as { $client?: { end: (o?: { timeout?: number }) => Promise<void> } }).$client
  await client?.end({ timeout: 5 })
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error")
  process.exit(1)
})
