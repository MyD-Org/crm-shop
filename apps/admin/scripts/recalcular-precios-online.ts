/**
 * Recálculo manual de los precios online (change `listas-precio-online`, tareas B.20 y B.23).
 *
 * POR DEFECTO ES UN ENSAYO (dry-run): corre `aplicar_precios_online(<tenant>, NULL, 'costo')` dentro
 * de una transacción y la DESHACE (ROLLBACK); informa cuántos precios cambiarían, cuántos costos se
 * retendrían por superar el umbral, y cuánto tardó el UPDATE masivo (con el advisory lock del
 * tenant tomado ese tiempo). Sirve para el paso U3: medir contra una copia de la base antes de
 * aplicar la migración 0064 en producción (si tarda más de ~10 s, partir por rangos de id).
 * Imprime SOLO conteos y tiempos, nunca costos, precios ni ids.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/recalcular-precios-online.ts --tenant <id>
 *   npx tsx ... scripts/recalcular-precios-online.ts --tenant <id> --ejecutar     # escribe de verdad
 *
 * Contra otra base: `CRM_DATABASE_URL="<conexión>"` (manda sobre DATABASE_URL; el script imprime el
 * host y, con --ejecutar sobre un host que no es local, pide `--confirmar-host <host>`).
 */
import postgres from "postgres"

const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}
const tenant = flag("--tenant")
const ejecutar = args.includes("--ejecutar")
if (!tenant) {
  console.error("Falta --tenant <id>.")
  process.exit(1)
}
const url = process.env.CRM_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error("Falta DATABASE_URL (o CRM_DATABASE_URL).")
  process.exit(1)
}
const host = new URL(url).hostname
console.log(`Base: ${new URL(url).host}  ·  tenant: ${tenant}  ·  modo: ${ejecutar ? "EJECUTAR" : "ensayo (se deshace)"}`)
const esLocal = host === "localhost" || host === "127.0.0.1" || host === "::1"
if (ejecutar && !esLocal && flag("--confirmar-host") !== host) {
  console.error(`Con --ejecutar sobre un host remoto indique --confirmar-host ${host}.`)
  process.exit(1)
}

class Ensayo extends Error {}

async function main() {
  const sql = postgres(url as string, { max: 1, onnotice: () => {} })
  try {
    const [antes] = await sql`
      SELECT count(*)::int AS productos,
             count(*) FILTER (WHERE costo IS NULL)::int AS sin_costo,
             count(*) FILTER (WHERE precios_online <> '[]'::jsonb)::int AS con_precio_online,
             (SELECT count(*)::int FROM listas_precio_online WHERE tenant_id = ${tenant} AND activa) AS listas_activas
      FROM catalog_products WHERE tenant_id = ${tenant}`
    console.log("\nAntes:", antes)

    let medido: { actualizados: number; retenidos: number; ms: number } | null = null
    const correr = async (tx: postgres.TransactionSql) => {
      const t0 = Date.now()
      const [r] = await tx`SELECT * FROM aplicar_precios_online(${tenant}, NULL::text[], 'costo')`
      medido = { actualizados: r.actualizados, retenidos: r.retenidos, ms: Date.now() - t0 }
      if (!ejecutar) throw new Ensayo()
    }
    try {
      await sql.begin(correr)
    } catch (e) {
      if (!(e instanceof Ensayo)) throw e
    }
    const m = medido as { actualizados: number; retenidos: number; ms: number } | null
    if (m) {
      console.log(`\nPrecios que ${ejecutar ? "se actualizaron" : "se actualizarían"}: ${m.actualizados}`)
      console.log(`Costos retenidos por superar el umbral: ${m.retenidos}`)
      console.log(`Duración del UPDATE masivo (con el lock del tenant tomado): ${m.ms} ms${m.ms > 10_000 ? "  ← más de 10 s: partir por rangos de id" : ""}`)
    }
    if (!ejecutar) console.log("\nEnsayo: no se escribió nada. Repita con --ejecutar para aplicar.")
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
