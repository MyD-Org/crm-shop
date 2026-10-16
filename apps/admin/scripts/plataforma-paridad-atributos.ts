/**
 * Paridad de atributos entre la tabla local (`catalog_atributos_legacy` desde el corte 0091) y la
 * vista `catalog_atributos_shop`.
 * Imprime el conteo y hasta 10 ejemplos por categoría. Código de salida 1 si hay diferencias.
 *
 *   TENANT=<id> npm run plataforma:paridad-atributos
 */
import { compararParidad } from "../src/lib/plataforma-backfill"

async function main() {
  const tenantId = process.env.TENANT
  if (!tenantId) throw new Error("Falta TENANT=<id>")
  const r = await compararParidad(tenantId)
  console.log(JSON.stringify({
    tenantId,
    soloTabla: r.soloTabla.length,
    soloVista: r.soloVista.length,
    distintos: r.distintos.length,
    ejemplos: { soloTabla: r.soloTabla.slice(0, 10), soloVista: r.soloVista.slice(0, 10), distintos: r.distintos.slice(0, 10) },
  }, null, 2))
  process.exit(r.soloTabla.length + r.soloVista.length + r.distintos.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
