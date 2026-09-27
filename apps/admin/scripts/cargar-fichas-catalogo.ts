/**
 * Carga masiva de fichas técnicas (PDF) del catálogo comercial (overlay del admin) desde archivos
 * locales.
 *
 * Hace lo mismo que el panel (FichaTecnicaProducto + POST/PUT
 * /api/admin/catalogo/productos/[id]/ficha), pero sin sesión de navegador: por cada PDF sube el
 * archivo TAL CUAL al bucket público con getShopMediaR2().put y guarda la referencia en
 * catalog_overlay.ficha_tecnica. Un solo aviso al Shop al terminar.
 *
 * Reglas:
 *   - NO pisa una ficha ya cargada a mano: si el producto ya tiene ficha en el overlay, se saltea.
 *   - El producto tiene que existir en el espejo de ESTE tenant (mismo chequeo que el endpoint).
 *   - Dry-run por defecto: sin --aplicar no sube ni escribe nada (sí valida, para chequear la entrada).
 *
 * Entrada: JSON { "<alegraId>": "/ruta/ficha.pdf", ... } (una sola ficha por producto).
 *
 *   npx tsx --env-file=.env scripts/cargar-fichas-catalogo.ts --tenant <id> --entrada fichas.json \
 *     [--aplicar] [--limite N] [--log tmp/cargar-fichas-log.jsonl]
 *   npx tsx --env-file=.env scripts/cargar-fichas-catalogo.ts --tenant <id> --revertir --log <log> [--aplicar]
 *
 * El log (JSONL) registra por producto la key subida y si el overlay quedó guardado. --revertir
 * vuelve a dejar SIN ficha los productos cuyo overlay sigue siendo exactamente el que escribió el
 * script (si alguien lo tocó después, no lo toca). Los objetos de R2 no se borran: se listan.
 */
import { existsSync, appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { getDb } from "../src/db"
import { avisarShop } from "../src/lib/aviso-shop"
import { detalleProducto, guardarOverlay, leerOverlay } from "../src/lib/catalogo-overlay-repo"
import { fichaKey, getShopMediaR2 } from "../src/lib/shop-media"
import type { FichaTecnicaOverlay } from "../src/db/schema"

const MAX_BYTES_FICHA = 10 * 1024 * 1024
const UPDATED_BY = "script:cargar-fichas-catalogo"

interface Args {
  tenant: string
  entrada?: string
  aplicar: boolean
  revertir: boolean
  limite?: number
  log: string
}

function leerArgs(argv: string[]): Args {
  const valor = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const tenant = valor("--tenant")
  if (!tenant) throw new Error("Falta --tenant <id>")
  const limite = valor("--limite")
  return {
    tenant,
    entrada: valor("--entrada"),
    aplicar: argv.includes("--aplicar"),
    revertir: argv.includes("--revertir"),
    limite: limite ? Number(limite) : undefined,
    log: valor("--log") ?? "tmp/cargar-fichas-catalogo-log.jsonl",
  }
}

function log(ruta: string, linea: Record<string, unknown>): void {
  mkdirSync(dirname(ruta), { recursive: true })
  appendFileSync(ruta, JSON.stringify({ ts: new Date().toISOString(), ...linea }) + "\n")
}

async function verificarBase(tenant: string): Promise<void> {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "")
  console.log(`base: ${/localhost|127\.0\.0\.1/.test(host) ? "LOCAL" : "REMOTA"}`)
  const filas = (await getDb().execute(sql`select id from tenants where id = ${tenant}`)) as unknown as { id: string }[]
  if (filas.length === 0) throw new Error(`El tenant ${JSON.stringify(tenant)} no existe en esta base.`)
}

async function cargar(a: Args): Promise<void> {
  if (!a.entrada) throw new Error("Falta --entrada <fichas.json>")
  const entrada = JSON.parse(readFileSync(a.entrada, "utf8")) as Record<string, unknown>
  const r2 = a.aplicar ? getShopMediaR2() : null
  if (a.aplicar && !r2) throw new Error("Falta la configuración del bucket de archivos (R2_SHOP_MEDIA_*).")

  const cuenta = { cargados: 0, yaTenian: 0, noExisten: 0, sinArchivo: 0, invalidos: 0 }
  let procesados = 0
  for (const [alegraId, rutaCruda] of Object.entries(entrada)) {
    if (a.limite !== undefined && procesados >= a.limite) break
    const ruta = typeof rutaCruda === "string" ? rutaCruda : ""

    if (!(await detalleProducto(a.tenant, alegraId))) {
      cuenta.noExisten++
      console.log(`  ${alegraId}: no existe en el catálogo de este tenant, se saltea`)
      continue
    }
    const overlay = await leerOverlay(a.tenant, alegraId)
    if (overlay?.fichaTecnica) {
      cuenta.yaTenian++
      console.log(`  ${alegraId}: ya tiene una ficha cargada (${overlay.fichaTecnica.nombre}), no se toca`)
      continue
    }
    if (!ruta) {
      cuenta.sinArchivo++
      continue
    }
    if (!existsSync(ruta)) throw new Error(`${alegraId}: no existe el archivo ${ruta}`)
    if (!ruta.toLowerCase().endsWith(".pdf")) {
      cuenta.invalidos++
      console.log(`  ${alegraId}: ${ruta} no es un PDF, se saltea`)
      continue
    }
    const bytes = readFileSync(ruta)
    if (bytes.byteLength > MAX_BYTES_FICHA) {
      cuenta.invalidos++
      console.log(`  ${alegraId}: ${ruta} supera los ${MAX_BYTES_FICHA / 1024 / 1024} MB, se saltea`)
      continue
    }
    procesados++

    const id = randomUUID()
    const key = fichaKey(a.tenant, alegraId, id)
    const nombre = ruta.split("/").pop() ?? "ficha.pdf"
    const ficha: FichaTecnicaOverlay = { key, nombre, bytes: bytes.byteLength }

    if (r2) {
      await r2.put(key, bytes, { contentType: "application/pdf" })
      log(a.log, { alegraId, estado: "subido", key })
    }
    console.log(`  ${alegraId}: ${nombre} → ${Math.round(bytes.byteLength / 1024)}KB`)
    if (!r2) continue

    // Segunda lectura justo antes de guardar: si alguien cargó una ficha a mano mientras tanto,
    // gana esa.
    const ahora = await leerOverlay(a.tenant, alegraId)
    if (ahora?.fichaTecnica) {
      console.log(`  ${alegraId}: le cargaron una ficha mientras tanto, no se guarda`)
      continue
    }
    await guardarOverlay(a.tenant, alegraId, { fichaTecnica: ficha }, UPDATED_BY)
    log(a.log, { alegraId, estado: "guardado", ficha })
    cuenta.cargados++
  }

  console.log(a.aplicar ? "APLICADO" : "DRY-RUN (sin --aplicar no se subió ni guardó nada)", cuenta)
  if (a.aplicar && cuenta.cargados > 0) {
    const { propagado } = await avisarShop(a.tenant)
    console.log(`aviso al Shop: ${propagado ? "entregado" : "no entregado (el cambio igual ya está en la base)"}`)
  }
}

async function revertir(a: Args): Promise<void> {
  if (!existsSync(a.log)) throw new Error(`No existe el log ${a.log}`)
  const lineas = readFileSync(a.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const guardados = new Map<string, FichaTecnicaOverlay>()
  for (const l of lineas) if (l.estado === "guardado") guardados.set(l.alegraId, l.ficha)

  let revertidos = 0
  for (const [alegraId, ficha] of guardados) {
    const overlay = await leerOverlay(a.tenant, alegraId)
    const igual = overlay?.fichaTecnica?.key === ficha.key
    if (!igual) {
      console.log(`  ${alegraId}: el overlay cambió después de la carga, no se toca`)
      continue
    }
    console.log(`  ${alegraId}: se quita la ficha del overlay (queda en R2: ${ficha.key})`)
    if (a.aplicar) {
      await guardarOverlay(a.tenant, alegraId, { fichaTecnica: null }, UPDATED_BY)
      revertidos++
    }
  }
  console.log(a.aplicar ? `revertidos: ${revertidos}` : "DRY-RUN del revertir")
  if (a.aplicar && revertidos > 0) await avisarShop(a.tenant)
}

async function main() {
  const a = leerArgs(process.argv.slice(2))
  await verificarBase(a.tenant)
  if (a.revertir) await revertir(a)
  else await cargar(a)
}

main()
  .catch((err) => {
    console.error("ERROR:", err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await (getDb() as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })
