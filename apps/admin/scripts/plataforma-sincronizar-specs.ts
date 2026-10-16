/**
 * Sincronización inicial de los specs de la plataforma a `catalog_specs` (rollout, antes de
 * activar el modo dual/on): el contrato pide que la app lea sus specs al arrancar; después el
 * receptor de eventos los mantiene al día (spec:update). Escritor equivalente de esa tabla.
 *
 *   TENANT=<id> npm run plataforma:sincronizar-specs
 *
 * Código de salida 1 si algún spec terminó en error o con documento inválido.
 */
import { getTenantByIdFromDb, plataformaConfigurada } from "../src/lib/tenants"
import { sincronizarSpecs } from "../src/lib/plataforma-specs"

async function main() {
  const tenantId = process.env.TENANT
  if (!tenantId) throw new Error("Falta TENANT=<id>")
  const t = await getTenantByIdFromDb(tenantId)
  if (!t || !plataformaConfigurada(t)) throw new Error(`tenant ${tenantId} sin plataforma configurada`)

  const resultados = await sincronizarSpecs(t)
  for (const r of resultados) console.log(`spec ${r.slug} tenant=${tenantId} ${r.resultado}${r.version != null ? ` v${r.version}` : ""}${r.error ? ` (${r.error})` : ""}`)
  process.exit(resultados.some((r) => r.resultado === "error" || r.resultado === "invalida") ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
