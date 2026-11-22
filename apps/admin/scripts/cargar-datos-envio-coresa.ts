/**
 * Carga los datos de envío (peso y medidas con embalaje, unidad mínima, unidades por caja master) de
 * los productos de Coresa en `catalog_datos_envio` (migración 0107), desde el índice de productos del
 * proveedor (JSON: array de filas con `SKU`, `Medidas Venta (cm)`, `Peso Venta (kg)`, `Unidad Mínima`,
 * `Caja Master`).
 *
 * Cruce: `catalog_products.code` sin el sufijo de marca (-MCL, -CHINT, -WDM, -UNV, -DCK, -INT, -KNG,
 * -PWS) = `SKU` del índice. La lógica es `planearCargaCoresa` (pura, con tests).
 *
 * Dry-run por defecto: sin --aplicar sólo imprime el resumen. Nunca pisa un dato cargado a mano
 * (`fuente = 'manual'`). Idempotente. No avisa al Shop: estos datos no viajan a la tienda.
 *
 *   DATABASE_URL="<conexión de la base>" npx tsx scripts/cargar-datos-envio-coresa.ts --tenant <id> --indice <archivo.json>            # dry-run
 *   DATABASE_URL="<conexión de la base>" npx tsx scripts/cargar-datos-envio-coresa.ts --tenant <id> --indice <archivo.json> --aplicar
 *
 * Opcional: --log <archivo.jsonl> escribe una línea por producto planeado (alegraId, code, datos).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { and, asc, eq, gt } from "drizzle-orm"
import { getDb } from "../src/db"
import { catalogProducts } from "../src/db/schema"
import { planearCargaCoresa, type FilaCoresa } from "../src/lib/catalogo-datos-envio"
import { guardarDatosEnvio } from "../src/lib/catalogo-datos-envio-repo"

const LOTE = 1000

function valor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const tenant = valor(argv, "--tenant")
  const indice = valor(argv, "--indice")
  if (!tenant || !indice) throw new Error("Uso: --tenant <id> --indice <archivo.json> [--aplicar] [--log <archivo.jsonl>]")
  const aplicar = argv.includes("--aplicar")
  const log = valor(argv, "--log")

  const filas = JSON.parse(readFileSync(indice, "utf8")) as FilaCoresa[]
  if (!Array.isArray(filas)) throw new Error("El índice tiene que ser un array de filas")

  const productos: { alegraId: string; code: string | null }[] = []
  let desde = ""
  for (;;) {
    const lote = await getDb()
      .select({ alegraId: catalogProducts.alegraId, code: catalogProducts.code })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenant), gt(catalogProducts.alegraId, desde)))
      .orderBy(asc(catalogProducts.alegraId))
      .limit(LOTE)
    if (lote.length === 0) break
    productos.push(...lote)
    desde = lote[lote.length - 1].alegraId
  }

  const plan = planearCargaCoresa(productos, filas)
  const c = plan.cargar
  const cuenta = (f: (d: (typeof c)[number]["datos"]) => boolean) => c.filter((x) => f(x.datos)).length
  console.log(`Productos del tenant: ${productos.length}. Filas del índice: ${filas.length}.`)
  console.log(`A cargar: ${c.length}`)
  console.log(`  con peso: ${cuenta((d) => d.pesoKg !== null)}`)
  console.log(`  con medidas: ${cuenta((d) => d.altoCm !== null)}`)
  console.log(`  con peso y medidas: ${cuenta((d) => d.pesoKg !== null && d.altoCm !== null)}`)
  console.log(`  con unidad mínima: ${cuenta((d) => d.unidadMinima !== null)}`)
  console.log(`  con caja master: ${cuenta((d) => d.unidadesPorCaja !== null)}`)
  console.log(`Sin el SKU en el índice: ${plan.sinMatch.length}${plan.sinMatch.length ? ` (ej.: ${plan.sinMatch.slice(0, 8).join(", ")})` : ""}`)
  console.log(`En el índice pero sin datos de envío: ${plan.sinDatos.length}`)
  console.log(`SKU repetido con datos distintos (no se carga): ${plan.ambiguos.length}${plan.ambiguos.length ? ` (${plan.ambiguos.slice(0, 8).join(", ")})` : ""}`)

  if (log) writeFileSync(log, c.map((x) => JSON.stringify(x)).join("\n") + "\n")

  if (!aplicar) {
    console.log("\nDry-run: no se escribió nada. Agregue --aplicar para cargar.")
    return
  }
  const escritas = await guardarDatosEnvio(tenant, c.map(({ alegraId, datos }) => ({ alegraId, datos })))
  console.log(`\nEscritas: ${escritas} (las que no se escribieron tienen un dato cargado a mano).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
