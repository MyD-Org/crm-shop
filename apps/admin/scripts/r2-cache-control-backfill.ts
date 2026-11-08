/**
 * Backfill de `Cache-Control: public, max-age=31536000, immutable` en el
 * bucket público de medios (shop-media).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/r2-cache-control-backfill.ts            # DRY-RUN
 *   npx tsx --env-file-if-exists=.env.local scripts/r2-cache-control-backfill.ts --ejecutar
 *
 * Opciones: --prefijos productos/,home/ (default: productos/,home/,categorias/,marca/)
 *           --concurrencia N (default 8)   --limite N (corta tras N objetos; para probar)
 *
 * Por objeto: HEAD y, si no tiene ya ese Cache-Control, CopyObject sobre sí
 * mismo con MetadataDirective REPLACE conservando content-type. Idempotente
 * (los que ya lo tienen se saltean) y no borra nada. Las keys llevan uuid/sha
 * y nunca se sobreescriben, por eso son inmutables.
 *
 * Entorno: R2_SHOP_MEDIA_* (ver src/lib/shop-media.ts). Imprime sólo
 * cantidades y keys; nunca credenciales.
 */
import { correrBackfill, crearBucket, PREFIJOS_DEFAULT, resumen } from "../src/lib/r2-cache-control-backfill"
import { shopMediaConfig } from "../src/lib/shop-media"

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar")
  const cfg = shopMediaConfig()
  if (!cfg) {
    console.error("Falta la config del bucket de medios (R2_SHOP_MEDIA_*).")
    process.exit(1)
  }
  const prefijos = opcion("--prefijos")?.split(",").map((p) => p.trim()).filter(Boolean) ?? [...PREFIJOS_DEFAULT]
  const concurrencia = Number(opcion("--concurrencia") ?? 8)
  const limite = opcion("--limite") ? Number(opcion("--limite")) : undefined
  if (!Number.isInteger(concurrencia) || concurrencia < 1 || concurrencia > 32) {
    console.error("--concurrencia tiene que ser un entero entre 1 y 32.")
    process.exit(1)
  }

  console.log(`cache-control backfill · bucket ${cfg.bucket} · prefijos ${prefijos.join(", ")}${ejecutar ? "" : " · DRY-RUN"}`)
  const r = await correrBackfill(crearBucket(cfg), { prefijos, ejecutar, concurrencia, limite, log: console.log })
  console.log(resumen(r, ejecutar))
  if (r.errores > 0) process.exit(2)
}

main().catch((err) => {
  console.error(`backfill falló: ${err instanceof Error ? err.message : "error"}`)
  process.exit(1)
})
