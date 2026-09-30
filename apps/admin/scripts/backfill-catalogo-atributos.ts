/**
 * Backfill de `catalog_atributos` (fuente 'nombre') desde el espejo de productos (migración 0047).
 *
 * Hace lo mismo que el hook de la sync de Alegra (`sincronizarAtributosDeNombre`), pero sobre TODO
 * el espejo del tenant, sin esperar a la próxima sync. Idempotente: correrlo dos veces da lo mismo
 * (la segunda no escribe nada) y nunca pisa filas `pdf` ni `manual` (precedencia en el upsert).
 *
 * Dry-run por defecto: sin --aplicar sólo cuenta qué escribiría.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/backfill-catalogo-atributos.ts --tenant <id> [--aplicar]
 *
 * NO se corre solo: requiere la migración 0047 aplicada en la base de destino.
 */
import { and, asc, eq, gt } from "drizzle-orm"
import { getDb } from "../src/db"
import { catalogProducts } from "../src/db/schema"
import { filasDeNombre, reemplazarAtributosDeNombre } from "../src/lib/catalogo-atributos-repo"

const LOTE = 500

function valor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const tenant = valor(argv, "--tenant")
  if (!tenant) throw new Error("Falta --tenant <id>")
  const aplicar = argv.includes("--aplicar")

  let desde = ""
  let productos = 0
  let conAtributos = 0
  let filas = 0
  let escritas = 0
  let borradas = 0
  const porClave = new Map<string, number>()
  for (;;) {
    const lote = await getDb()
      .select({ alegraId: catalogProducts.alegraId, name: catalogProducts.name, description: catalogProducts.description })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenant), gt(catalogProducts.alegraId, desde)))
      .orderBy(asc(catalogProducts.alegraId))
      .limit(LOTE)
    if (lote.length === 0) break
    desde = lote[lote.length - 1].alegraId
    productos += lote.length
    const extraidas = filasDeNombre(lote)
    filas += extraidas.length
    conAtributos += new Set(extraidas.map((f) => f.alegraId)).size
    for (const f of extraidas) porClave.set(f.clave, (porClave.get(f.clave) ?? 0) + 1)
    if (aplicar) {
      const r = await reemplazarAtributosDeNombre(tenant, lote)
      escritas += r.escritas
      borradas += r.borradas
    }
  }

  console.log(`tenant=${tenant} productos=${productos} conAtributos=${conAtributos} filas=${filas}`)
  console.log(`por clave: ${[...porClave].map(([k, n]) => `${k}=${n}`).join(" ")}`)
  console.log(aplicar ? `escritas=${escritas} borradas=${borradas}` : "dry-run: no se escribió nada (usar --aplicar)")
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
