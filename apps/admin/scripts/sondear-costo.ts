/**
 * SOLO LECTURA. Cobertura del costo en el espejo (change `listas-precio-online`, tarea A.3 y
 * paso U2 tras la primera sync): cuántos productos de `catalog_products` tienen costo > 0 vs
 * null/0, por cuenta (principal / solo-secundaria `<slug>:`) y las marcas con más productos sin
 * costo. Imprime SOLO agregados (conteos y porcentajes), nunca costos ni ids.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-costo.ts --tenant <id-del-tenant> [--top 15]
 *
 * Contra otra base: `CRM_DATABASE_URL="<conexión>" npx tsx ... ` (manda sobre DATABASE_URL; el
 * script imprime el host al que se conecta). No escribe nada: solo SELECT dentro de una
 * transacción READ ONLY.
 */
import postgres from "postgres"

const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}

const tenant = flag("--tenant")
const top = Math.max(1, Math.min(100, Number(flag("--top") ?? 15) || 15))
if (!tenant) {
  console.error("Falta --tenant <id>.")
  process.exit(1)
}
const url = process.env.CRM_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error("Falta DATABASE_URL (o CRM_DATABASE_URL).")
  process.exit(1)
}
console.log(`Base: ${new URL(url).host}  ·  tenant: ${tenant}`)

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)} %`)

async function main() {
  const sql = postgres(url as string, { max: 1, onnotice: () => {} })
  try {
    await sql.begin("read only", async (tx) => {
      const porCuenta = await tx`
        SELECT CASE WHEN alegra_id LIKE '%:%' THEN split_part(alegra_id, ':', 1) ELSE 'principal' END AS cuenta,
               count(*)::int AS total,
               count(*) FILTER (WHERE costo > 0)::int AS con_costo,
               count(*) FILTER (WHERE costo IS NULL OR costo <= 0)::int AS sin_costo,
               count(*) FILTER (WHERE costo > 0 AND costo_aplicado IS NULL)::int AS sin_aplicar
        FROM catalog_products
        WHERE tenant_id = ${tenant} AND status = 'active'
        GROUP BY 1 ORDER BY 1`
      console.log("\nProductos activos por cuenta:")
      let T = 0
      let C = 0
      for (const r of porCuenta) {
        T += r.total
        C += r.con_costo
        console.log(`  ${String(r.cuenta).padEnd(12)} total=${r.total}  con costo=${r.con_costo} (${pct(r.con_costo, r.total)})  sin costo=${r.sin_costo}  costo_aplicado sin inicializar=${r.sin_aplicar}`)
      }
      console.log(`  ${"TOTAL".padEnd(12)} total=${T}  con costo=${C} (${pct(C, T)})`)

      const marcas = await tx`
        SELECT coalesce(nullif(btrim(brand), ''), '(sin marca)') AS marca,
               count(*)::int AS total,
               count(*) FILTER (WHERE costo IS NULL OR costo <= 0)::int AS sin_costo
        FROM catalog_products
        WHERE tenant_id = ${tenant} AND status = 'active'
        GROUP BY 1
        HAVING count(*) FILTER (WHERE costo IS NULL OR costo <= 0) > 0
        ORDER BY sin_costo DESC, marca
        LIMIT ${top}`
      console.log(`\nMarcas con más productos sin costo (top ${top}):`)
      if (marcas.length === 0) console.log("  (ninguna: todos los productos activos tienen costo)")
      for (const m of marcas) console.log(`  ${String(m.marca).padEnd(30)} sin costo=${m.sin_costo}/${m.total} (${pct(m.sin_costo, m.total)})`)
    })
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error")
  process.exit(1)
})
