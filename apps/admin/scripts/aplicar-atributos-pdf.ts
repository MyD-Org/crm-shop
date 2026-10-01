/**
 * Sube a `catalog_atributos` (fuente 'pdf') lo que aceptó `verificar-atributos-pdf.ts`.
 *
 * Respeta la precedencia manual > pdf > nombre (la regla vive en el SQL del upsert): nunca pisa un
 * dato cargado a mano. Dry-run por defecto: lee las filas actuales y cuenta qué pasaría (nuevas,
 * cambian, ya iguales, protegidas por manual) sin escribir. Escribir exige --aplicar.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/aplicar-atributos-pdf.ts \
 *     --desde <dir>/lectura/aceptados.jsonl --tenant <id> [--aplicar]
 *
 * La base de destino es la de .env.local (local, salvo que se indique otra explícitamente).
 */
import { readFile } from "node:fs/promises"
import { aplicarAceptados, formatearResumenAplicar } from "../src/lib/catalogo-atributos-lectura-local"
import { avisarShop } from "../src/lib/aviso-shop"
import { leerAtributosDeProductos, upsertAtributos } from "../src/lib/catalogo-atributos-repo"

function valor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const desde = valor(argv, "--desde")
  const tenant = valor(argv, "--tenant")
  if (!desde) throw new Error("Falta --desde <aceptados.jsonl>")
  if (!tenant) throw new Error("Falta --tenant <id>")
  const aplicar = argv.includes("--aplicar")

  const resumen = await aplicarAceptados(
    await readFile(desde, "utf8"),
    tenant,
    {
      leerExistentes: leerAtributosDeProductos,
      upsertPdf: (t, filas) => upsertAtributos(t, filas, "pdf"),
      avisarShop,
    },
    aplicar,
  )
  console.log(`tenant=${tenant}`)
  console.log(formatearResumenAplicar(resumen, aplicar))
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
