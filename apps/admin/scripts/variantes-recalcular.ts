/**
 * Recalcula grupos, etiquetas y representantes de las variantes de un tenant (change
 * `variantes-de-producto`, S2 2.16). Llama a `recalcularGrupos` sobre TODO el tenant.
 *
 * POR DEFECTO ES UN ENSAYO (dry-run): corre el recálculo dentro de una transacción y la DESHACE
 * (ROLLBACK); informa cuántos grupos y cuántas filas cambiarían. Con --ejecutar escribe de verdad.
 * Imprime SOLO conteos, nunca nombres, códigos ni ids.
 *
 *   DATABASE_URL="<conexión>" npx tsx scripts/variantes-recalcular.ts --tenant <id>
 *   DATABASE_URL="<conexión>" npx tsx scripts/variantes-recalcular.ts --tenant <id> --ejecutar
 *
 * Con --ejecutar sobre un host que no es local exige `--confirmar-host <host>`. Hace falta antes de
 * prender el flag `variantes-selector` (la migración deja `es_representante` en true para todos).
 */
import { getDb } from "../src/db"
import { recalcularGrupos } from "../src/lib/catalogo-variantes-repo"

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
  let resultado: { grupos: number; cambiados: number } | null = null
  try {
    await db.transaction(async (tx) => {
      resultado = await recalcularGrupos(tenant as string, {}, tx)
      if (!ejecutar) throw new Ensayo()
    })
  } catch (e) {
    if (!(e instanceof Ensayo)) throw e
  }
  const r = resultado as { grupos: number; cambiados: number } | null
  console.log(`Grupos con variantes: ${r?.grupos ?? 0}  ·  filas ${ejecutar ? "cambiadas" : "que cambiarían"}: ${r?.cambiados ?? 0}`)
  if (!ejecutar) console.log("Ensayo: no se escribió nada. Use --ejecutar para aplicar.")
  const client = (db as unknown as { $client?: { end: (o?: { timeout?: number }) => Promise<void> } }).$client
  await client?.end({ timeout: 5 })
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error")
  process.exit(1)
})
