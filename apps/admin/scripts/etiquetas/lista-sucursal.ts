/**
 * SOLO LECTURA. Arma la lista para codigos.ts con los productos activos que tienen stock
 * registrado en una sucursal, filtrados por marca o por sufijo de la referencia.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/etiquetas/lista-sucursal.ts \
 *     --tenant <id> --sucursal <id> [--marca <marca>] [--sufijo <-XYZ>] [--una] --salida lista.json
 *
 * Cantidad = stock de la sucursal (redondeado, mínimo 1); con --una sale una etiqueta por
 * producto. Contra otra base: CRM_DATABASE_URL="<conexión>" (manda sobre DATABASE_URL).
 */
import { writeFileSync } from "node:fs"
import postgres from "postgres"

async function main() {
  const args = process.argv.slice(2)
  const flag = (n: string) => {
    const i = args.indexOf(n)
    return i >= 0 && args[i + 1] ? args[i + 1] : null
  }
  const tenant = flag("--tenant")
  const sucursal = flag("--sucursal")
  const marca = flag("--marca")
  const sufijo = flag("--sufijo")
  const salida = flag("--salida")
  const una = args.includes("--una")
  if (!tenant || !sucursal || !salida || (!marca && !sufijo)) {
    console.error("Uso: --tenant <id> --sucursal <id> (--marca <m> | --sufijo <s>) [--una] --salida <lista.json>")
    process.exit(1)
  }
  const url = process.env.CRM_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    console.error("Falta DATABASE_URL (o CRM_DATABASE_URL).")
    process.exit(1)
  }
  console.log("base:", new URL(url).host)

  const sql = postgres(url, { prepare: false, max: 1 })
  try {
    const filas = await sql.begin("read only", (tx) => tx<{ code: string | null; name: string; stock: number }[]>`
      select p.code, p.name, s.stock::float as stock
      from catalog_products p
      join catalog_stock_sucursal s
        on s.tenant_id = p.tenant_id and s.alegra_id = p.alegra_id and s.sucursal = ${sucursal}
      where p.tenant_id = ${tenant} and p.alegra_status = 'active'
        and (
          (${marca}::text is not null and (upper(p.brand) = upper(${marca}) or p.name ilike '%' || ${marca} || '%'))
          or (${sufijo}::text is not null and p.code like '%' || ${sufijo})
        )
      order by p.code`)
    const lista = filas
      .filter((f) => f.code)
      .map((f) => [f.code, f.name, una ? 1 : Math.max(1, Math.round(f.stock))] as const)
    writeFileSync(salida, JSON.stringify(lista, null, 1))
    const sinRef = filas.length - lista.length
    console.log(`productos ${lista.length}${sinRef ? ` (${sinRef} sin referencia, salteados)` : ""} → ${salida}`)
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
