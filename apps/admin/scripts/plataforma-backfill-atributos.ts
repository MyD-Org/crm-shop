/**
 * Carga inicial de la tabla local de atributos (`catalog_atributos_legacy` desde el corte 0091) en
 * la plataforma (rollout, paso de backfill). Una pasada por
 * (producto, fuente) en orden nombre → pdf → manual, sequential, para que la precedencia de la
 * plataforma deje `fuentes` igual que la tabla. La pasada `nombre` va con reemplaza_fuente (y cubre
 * a todo producto con filas, aunque sin nombre: data {}) para que las claves que sobran en la
 * plataforma converjan; pdf y manual sólo agregan.
 * Requiere el tenant con la plataforma configurada y los productos ya espejados.
 *
 *   TENANT=<id> npm run plataforma:backfill-atributos
 *
 * Código de salida 1 si alguna pasada terminó en error (no en rechazo de schema).
 */
import { eq } from "drizzle-orm"
import { getDb } from "../src/db"
import { catalogAtributosLegacy } from "../src/db/schema"
import { getTenantByIdFromDb, plataformaConfigurada } from "../src/lib/tenants"
import { escribirAtributosPlataforma } from "../src/lib/plataforma-atributos"
import { pasadasPorFuente } from "../src/lib/plataforma-backfill"

async function main() {
  const tenantId = process.env.TENANT
  if (!tenantId) throw new Error("Falta TENANT=<id>")
  const t = await getTenantByIdFromDb(tenantId)
  if (!t || !plataformaConfigurada(t)) throw new Error(`tenant ${tenantId} sin plataforma configurada`)

  const propias = await getDb().select().from(catalogAtributosLegacy).where(eq(catalogAtributosLegacy.tenantId, tenantId))
  const pasadas = pasadasPorFuente(propias.map((f) => ({ alegraId: f.alegraId, clave: f.clave, valorNum: f.valorNum, valorTexto: f.valorTexto, fuente: f.fuente })))

  const conteo = { ok: 0, rechazados: 0, errores: 0 }
  for (const p of pasadas) {
    const r = await escribirAtributosPlataforma(t, p.alegraId, p.data, p.fuente, { reemplaza: p.reemplaza })
    if (r === "ok") conteo.ok++
    else if (r === "rechazado") conteo.rechazados++
    else conteo.errores++
  }
  console.log(`backfill tenant=${tenantId} filas=${propias.length} pasadas=${pasadas.length} ok=${conteo.ok} rechazados=${conteo.rechazados} errores=${conteo.errores}`)
  process.exit(conteo.errores > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
