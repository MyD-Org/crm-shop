/**
 * Backfill por NOMBRE de UNA clave numérica (fuente 'nombre'): `seccion_mm2` (cables, por defecto),
 * `diametro_mm` (caños y accesorios de caño) o `ancho_mm` (bandejas portacables), elegida con `--clave`.
 *
 * Escribe SOLO esa clave y SOLO con fuente 'nombre'. Nunca pisa una fila `pdf` o
 * `manual` (precedencia manual > pdf > nombre: la impone el SQL del upsert de
 * `catalogo-atributos-repo`) y no borra nada. Idempotente: la segunda corrida no escribe.
 *
 * Dry-run por defecto: sin --aplicar sólo imprime el resumen de lo que escribiría. Escribir exige
 * el flag explícito --aplicar. La lógica de qué escribir es la de `planearBackfillClave` (pura).
 *
 *   DATABASE_URL="<conexión de la base>" npx tsx scripts/backfill-seccion-cables.ts --tenant <id> [--clave diametro_mm]            # dry-run
 *   DATABASE_URL="<conexión de la base>" npx tsx scripts/backfill-seccion-cables.ts --tenant <id> [--clave diametro_mm] --aplicar
 *
 * diametro_mm y ancho_mm exigen la migración 0070 en la base de destino (si no, el CHECK de `clave` rechaza el INSERT).
 *
 * Sin DATABASE_URL usa la base local. La próxima sync de Alegra escribe lo mismo sola (el extractor
 * es el mismo): este script sólo adelanta el resultado.
 */
import { and, asc, eq, gt } from "drizzle-orm"
import { getDb } from "../src/db"
import { catalogProducts } from "../src/db/schema"
import { CLAVES_BACKFILL_NOMBRE, planearBackfillClave, type ClaveBackfillNombre, type FilaGuardada } from "../src/lib/catalogo-atributos-auditoria"
import { leerAtributosDeProductos, upsertAtributos, type FilaAtributo } from "../src/lib/catalogo-atributos-repo"

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
  const clave = (valor(argv, "--clave") ?? "seccion_mm2") as ClaveBackfillNombre
  if (!CLAVES_BACKFILL_NOMBRE.includes(clave)) {
    throw new Error(`--clave debe ser una de: ${CLAVES_BACKFILL_NOMBRE.join(", ")}`)
  }

  let desde = ""
  let productos = 0
  const total = { nuevas: 0, cambian: 0, iguales: 0, protegidas: 0, protegidasDistintas: 0 }
  let escritas = 0
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

    const guardadas = await leerAtributosDeProductos(
      tenant,
      lote.map((p) => p.alegraId),
    )
    const existentes = new Map<string, FilaGuardada>()
    for (const p of lote) {
      const g = guardadas.get(`${p.alegraId}|${clave}`)
      if (g) existentes.set(p.alegraId, { fuente: g.fuente, valorNum: g.valorNum })
    }
    const plan = planearBackfillClave(clave, lote, existentes)
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += plan[k]
    if (aplicar && plan.filas.length > 0) escritas += await upsertAtributos(tenant, plan.filas satisfies FilaAtributo[], "nombre")
  }

  console.log(`tenant=${tenant} productos=${productos}`)
  console.log(
    `${clave} desde el nombre: nuevas=${total.nuevas} cambian=${total.cambian} iguales=${total.iguales} ` +
      `protegidas(pdf/manual)=${total.protegidas} (con otro valor en el nombre: ${total.protegidasDistintas})`,
  )
  console.log(aplicar ? `escritas=${escritas}` : "dry-run: no se escribió nada (usar --aplicar)")
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
