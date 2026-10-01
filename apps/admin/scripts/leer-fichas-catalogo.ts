/**
 * Lote de lectura de fichas técnicas (PDF) con Claude Haiku → `catalog_atributos` (fuente 'pdf').
 *
 * POR DEFECTO ES DRY-RUN Y NO HACE NADA MÁS QUE ESTIMAR: cuenta los productos del tenant con
 * ficha cargada (y, con --pendientes, los que todavía no tienen ningún dato leído del PDF) y
 * estima tokens y costo con la heurística de `lib/catalogo-atributos-pdf.ts`. No descarga PDFs,
 * no llama a Anthropic y no escribe.
 *
 * Leer de verdad requiere --ejecutar (decisión de Emanuel: spec fase 2, "no se corre sin
 * decisión"). Con --ejecutar procesa de a uno, respeta la precedencia (no pisa valores manuales)
 * y se puede acotar con --limite.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/leer-fichas-catalogo.ts --tenant <id> \
 *     [--pendientes] [--paginas-promedio 2] [--ejecutar [--limite N]]
 */
import { sql } from "drizzle-orm"
import { getDb } from "../src/db"
import { avisarShop } from "../src/lib/aviso-shop"
import { upsertAtributos } from "../src/lib/catalogo-atributos-repo"
import { estimarCostoLote, leerFichaPdf, MODELO_FICHA, PRECIO_HAIKU_POR_MTOK, TOKENS_POR_PAGINA } from "../src/lib/catalogo-atributos-pdf"
import { getShopMediaR2 } from "../src/lib/shop-media"

const MAX_BYTES_FICHA = 10 * 1024 * 1024

function valor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

interface Fila {
  alegra_id: string
  nombre: string
  key: string
  bytes: number | null
}

async function main() {
  const argv = process.argv.slice(2)
  const tenant = valor(argv, "--tenant")
  if (!tenant) throw new Error("Falta --tenant <id>")
  const ejecutar = argv.includes("--ejecutar")
  const pendientes = argv.includes("--pendientes")
  const paginas = Number(valor(argv, "--paginas-promedio") ?? 2)
  const limite = valor(argv, "--limite") ? Number(valor(argv, "--limite")) : undefined
  if (!Number.isFinite(paginas) || paginas <= 0) throw new Error("--paginas-promedio inválido")

  const filas = (await getDb().execute(sql`
    SELECT o.alegra_id, coalesce(nullif(o.nombre, ''), nullif(p.description, ''), p.name) AS nombre,
           o.ficha_tecnica->>'key' AS key, (o.ficha_tecnica->>'bytes')::int AS bytes
    FROM catalog_overlay o
    JOIN catalog_products p ON p.tenant_id = o.tenant_id AND p.alegra_id = o.alegra_id
    WHERE o.tenant_id = ${tenant} AND o.ficha_tecnica IS NOT NULL
      ${pendientes ? sql`AND NOT EXISTS (SELECT 1 FROM catalog_atributos a WHERE a.tenant_id = o.tenant_id AND a.alegra_id = o.alegra_id AND a.fuente = 'pdf')` : sql``}
    ORDER BY o.alegra_id
  `)) as unknown as Fila[]

  const mb = filas.reduce((s, f) => s + (f.bytes ?? 0), 0) / 1024 / 1024
  const e = estimarCostoLote(filas.length, paginas)
  console.log(`tenant=${tenant} fichas=${filas.length}${pendientes ? " (pendientes)" : ""} peso=${mb.toFixed(1)} MB`)
  console.log(
    `estimación ${MODELO_FICHA} ($${PRECIO_HAIKU_POR_MTOK.entrada}/$${PRECIO_HAIKU_POR_MTOK.salida} por MTok, ` +
      `${paginas} pág. × ${TOKENS_POR_PAGINA} tokens): entrada≈${e.tokensEntrada} salida≈${e.tokensSalida} costo≈US$ ${e.usd}`,
  )
  if (!ejecutar) {
    console.log("dry-run: no se leyó ningún PDF ni se escribió nada (usar --ejecutar para leer)")
    process.exit(0)
  }

  const r2 = getShopMediaR2()
  if (!r2) throw new Error("R2 de medios sin configurar")
  let ok = 0
  let fallos = 0
  let escritas = 0
  let entrada = 0
  let salida = 0
  for (const f of filas.slice(0, limite ?? filas.length)) {
    try {
      const pdf = await r2.getObject(f.key, { maxBytes: MAX_BYTES_FICHA })
      if (!pdf) throw new Error("no está en R2")
      const r = await leerFichaPdf(pdf, f.nombre)
      escritas += await upsertAtributos(tenant, r.atributos.map((a) => ({ alegraId: f.alegra_id, ...a })), "pdf")
      entrada += r.uso.entrada
      salida += r.uso.salida
      ok++
    } catch (err) {
      fallos++
      console.warn(`producto=${f.alegra_id} falló: ${err instanceof Error ? err.message : "error"}`)
    }
  }
  if (escritas) await avisarShop(tenant)
  const usd = (entrada * PRECIO_HAIKU_POR_MTOK.entrada + salida * PRECIO_HAIKU_POR_MTOK.salida) / 1_000_000
  console.log(`leídas=${ok} fallos=${fallos} filas escritas=${escritas} tokens=${entrada}/${salida} costo real≈US$ ${usd.toFixed(2)}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
