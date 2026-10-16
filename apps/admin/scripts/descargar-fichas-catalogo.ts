/**
 * Descarga las fichas técnicas (PDF) de R2 a una carpeta local de trabajo para la lectura con verificación
 * (`scripts/README-atributos-pdf.md`): escribe `<dir>/pdfs/<archivo>` y `<dir>/indice.json`. SOLO LEE (base y
 * R2): no escribe en la base ni en R2.
 *
 * Un PDF por contenido: los productos que comparten la misma key de R2 quedan en una sola entrada del índice
 * (el verificador trata como "ficha propia" sólo los PDF con UN producto).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/descargar-fichas-catalogo.ts --tenant <id> --dir <dir> \
 *     --categoria "Lámparas" [--categoria "Embutidos"]... [--sin-clave angulo_grados] [--limite N]
 *
 * `--categoria` toma el nombre de una categoría del Shop: incluye sus subcategorías. `--sin-clave` deja sólo los
 * productos que todavía no tienen esa clave en los atributos actuales (de cualquier fuente; en
 * modo `on`, la proyección de la plataforma).
 *
 * Lee con el cliente R2 si hay credenciales; si no, por la URL pública del bucket de medios (la misma con la que
 * el Shop sirve la ficha: `R2_SHOP_MEDIA_PUBLIC_URL`). La URL nunca se imprime.
 *
 * La carpeta va FUERA de git (repo público: nada de PDFs ni índices con datos del catálogo).
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { sql } from "drizzle-orm"
import { getDb } from "../src/db"
import { CLAVES_ATRIBUTO, type ClaveAtributo } from "../src/lib/catalogo-atributos-extraccion"
import { origenAtributosSql } from "../src/lib/catalogo-atributos-repo"
import { modoAtributosDe } from "../src/lib/plataforma-atributos"
import type { IndiceLocal } from "../src/lib/catalogo-atributos-lectura-local"
import { getShopMediaR2, urlPublicaFoto } from "../src/lib/shop-media"

const MAX_BYTES_FICHA = 40 * 1024 * 1024
const CONCURRENCIA = 6

interface Args {
  tenant: string
  dir: string
  categorias: string[]
  sinClave?: ClaveAtributo
  limite?: number
}

function leerArgs(argv: string[]): Args {
  const valores = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []))
  const tenant = valores("--tenant")[0]
  const dir = valores("--dir")[0]
  const categorias = valores("--categoria")
  if (!tenant || !dir || categorias.length === 0) throw new Error("Uso: --tenant <id> --dir <dir> --categoria <nombre> [--categoria ...]")
  const sinClave = valores("--sin-clave")[0]
  if (sinClave && !(CLAVES_ATRIBUTO as readonly string[]).includes(sinClave)) throw new Error(`--sin-clave desconocida: ${sinClave}`)
  const limite = valores("--limite")[0]
  return { tenant, dir, categorias, sinClave: sinClave as ClaveAtributo | undefined, limite: limite ? Number(limite) : undefined }
}

interface Fila {
  alegra_id: string
  code: string | null
  nombre: string
  marca: string | null
  key: string
}

async function main() {
  const a = leerArgs(process.argv.slice(2))
  const origen = origenAtributosSql(await modoAtributosDe(a.tenant))
  const filas = (await getDb().execute(sql`
    WITH RECURSIVE cats AS (
      SELECT id FROM shop_categories WHERE tenant_id = ${a.tenant} AND nombre IN ${a.categorias}
      UNION
      SELECT c.id FROM shop_categories c JOIN cats ON c.parent_id = cats.id
    )
    SELECT o.alegra_id, p.code, coalesce(nullif(o.nombre, ''), nullif(p.description, ''), p.name) AS nombre,
           p.brand AS marca, o.ficha_tecnica->>'key' AS key
    FROM catalog_overlay o
    JOIN catalog_products p ON p.tenant_id = o.tenant_id AND p.alegra_id = o.alegra_id
    WHERE o.tenant_id = ${a.tenant} AND o.ficha_tecnica IS NOT NULL AND o.categoria_id IN (SELECT id FROM cats)
      ${a.sinClave ? sql`AND NOT EXISTS (SELECT 1 FROM ${origen} x WHERE x.tenant_id = o.tenant_id AND x.alegra_id = o.alegra_id AND x.clave = ${a.sinClave})` : sql``}
    ORDER BY o.ficha_tecnica->>'key', o.alegra_id
  `)) as unknown as Fila[]

  // Un archivo por key de R2 (por contenido): los productos que la comparten van juntos.
  const porKey = new Map<string, Fila[]>()
  for (const f of filas) porKey.set(f.key, [...(porKey.get(f.key) ?? []), f])
  const keys = [...porKey.keys()].slice(0, a.limite ?? porKey.size)
  console.log(`tenant=${a.tenant} categorías=${a.categorias.join(", ")} productos=${filas.length} pdfs=${porKey.size} a bajar=${keys.length}`)

  const r2 = getShopMediaR2()
  if (!r2 && !urlPublicaFoto("x")) throw new Error("R2 de medios sin configurar (ni credenciales ni R2_SHOP_MEDIA_PUBLIC_URL)")
  const bajar = async (key: string): Promise<Uint8Array | null> => {
    if (r2) return r2.getObject(key, { maxBytes: MAX_BYTES_FICHA })
    const res = await fetch(urlPublicaFoto(key)!, { signal: AbortSignal.timeout(60_000) })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES_FICHA) throw new Error(`más de ${MAX_BYTES_FICHA} bytes`)
    return buf
  }
  mkdirSync(join(a.dir, "pdfs"), { recursive: true })
  const indice: IndiceLocal[] = []
  const usados = new Set<string>()
  let bajados = 0
  let yaEstaban = 0
  let fallos = 0
  const cola = [...keys]
  const trabajar = async () => {
    for (let key = cola.shift(); key; key = cola.shift()) {
      let archivo = basename(key)
      for (let i = 2; usados.has(archivo); i++) archivo = `${basename(key, ".pdf")}-${i}.pdf`
      usados.add(archivo)
      const destino = join(a.dir, "pdfs", archivo)
      try {
        if (existsSync(destino)) {
          yaEstaban++
        } else {
          const pdf = await bajar(key)
          if (!pdf) throw new Error("no está en R2")
          writeFileSync(destino, pdf)
          bajados++
        }
        indice.push({
          archivo,
          bytes: statSync(destino).size,
          productos: porKey.get(key)!.map((f) => ({ id: f.alegra_id, code: f.code, nombre: f.nombre, marca: f.marca })),
        })
      } catch (err) {
        fallos++
        console.warn(`key=${archivo} falló: ${err instanceof Error ? err.message : "error"}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajar))
  indice.sort((x, y) => x.archivo.localeCompare(y.archivo))
  writeFileSync(join(a.dir, "indice.json"), JSON.stringify(indice, null, 1))
  console.log(`bajados=${bajados} ya estaban=${yaEstaban} fallos=${fallos} → ${join(a.dir, "indice.json")}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
