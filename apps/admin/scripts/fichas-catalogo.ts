/**
 * Fichas técnicas del catálogo POR CONTENIDO: un solo objeto de R2 por PDF distinto, y todos los
 * productos con el mismo PDF apuntan a la misma key (`productos/{tenant}/fichas/{sha256}.pdf`).
 *
 * Modo LOCAL: trabaja sobre una carpeta con los PDF ya descargados (no descarga nada):
 *   <dir>/indice.json        [{ archivo, bytes, productos: [{ id, ... }] }]
 *   <dir>/pdfs/<archivo>     el PDF
 *
 *   npx tsx scripts/fichas-catalogo.ts planificar --dir <dir> --tenant <id>
 *       Genera <dir>/plan-r2.json. SIN red ni base: sólo lee los PDF locales y calcula sha256.
 *   npx tsx --env-file=.env scripts/fichas-catalogo.ts aplicar --dir <dir> --tenant <id> \
 *       [--ejecutar] [--limite N] [--producto ID]...
 *       Dry-run por defecto (lee la base y hace HEAD en R2, no escribe). Con --ejecutar sube a R2
 *       los objetos que falten (HEAD antes de PUT) y cambia la ficha de cada producto con
 *       compare-and-swap sobre la key vigente, guardando la copia anterior en `origen`.
 *   npx tsx --env-file=.env scripts/fichas-catalogo.ts revertir --dir <dir> --tenant <id> \
 *       [--ejecutar] [--limite N] [--producto ID]...
 *       Devuelve los productos a `origen.key`. No borra nada.
 *   npx tsx --env-file=.env scripts/fichas-catalogo.ts huerfanos --tenant <id>
 *       SOLO LISTA las copias viejas (`origen`) que ningún producto usa. NO borra nada de R2: el
 *       borrado es un paso posterior, con OK explícito.
 *
 * Nunca borra objetos de R2. No toca el contenido de los PDF (no se corta ni se recomprime nada).
 */
import { createHash } from "node:crypto"
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  aplicarPlan,
  calcularRespaldosSinUso,
  planificarFichas,
  revertirPlan,
  type EntradaIndice,
  type PlanFichasR2,
} from "../src/lib/catalogo-ficha-contenido"

const UPDATED_BY = "script:fichas-catalogo"

interface Args {
  comando: string
  dir?: string
  tenant?: string
  ejecutar: boolean
  limite?: number
  productos: string[]
}

function leerArgs(argv: string[]): Args {
  const [comando = "", ...resto] = argv
  const valores = (flag: string) => resto.flatMap((a, i) => (a === flag && resto[i + 1] ? [resto[i + 1]] : []))
  const limite = valores("--limite")[0]
  return {
    comando,
    dir: valores("--dir")[0],
    tenant: valores("--tenant")[0],
    ejecutar: resto.includes("--ejecutar"),
    limite: limite !== undefined ? Number(limite) : undefined,
    productos: valores("--producto"),
  }
}

function hashearArchivo(ruta: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256")
    let bytes = 0
    createReadStream(ruta)
      .on("data", (c) => {
        h.update(c)
        bytes += (c as Buffer).length
      })
      .on("error", reject)
      .on("end", () => resolve({ sha256: h.digest("hex"), bytes }))
  })
}

function exigir<T>(v: T | undefined, nombre: string): T {
  if (v === undefined || v === "") throw new Error(`Falta ${nombre}`)
  return v
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

async function planificar(a: Args): Promise<void> {
  const dir = exigir(a.dir, "--dir <carpeta>")
  const tenant = exigir(a.tenant, "--tenant <id>")
  const indice = JSON.parse(readFileSync(join(dir, "indice.json"), "utf8")) as EntradaIndice[]
  let hechos = 0
  const plan = await planificarFichas(tenant, indice, {
    async hashear(archivo) {
      const ruta = join(dir, "pdfs", archivo)
      if (!existsSync(ruta)) return null
      if (++hechos % 500 === 0) console.log(`  hasheados ${hechos}/${indice.length}`)
      try {
        return await hashearArchivo(ruta)
      } catch {
        return null
      }
    },
  })
  const salida = join(dir, "plan-r2.json")
  writeFileSync(salida, JSON.stringify(plan))
  const r = plan.resumen
  console.log(`plan escrito en ${salida}`)
  console.log(`  archivos leídos:            ${r.archivosLeidos} (faltantes: ${plan.faltantes.length})`)
  console.log(`  productos:                  ${r.productos} (repetidos descartados: ${r.productosRepetidos})`)
  console.log(`  objetos a subir:            ${r.objetos} (${mb(r.bytesObjetos)})`)
  console.log(`  copias por producto hoy:    ${mb(r.bytesCopiasPorProducto)}`)
  console.log(`  ahorro:                     ${mb(r.bytesAhorrados)}`)
  console.log(`  productos con PDF compartido: ${r.productosConObjetoCompartido}`)
  console.log(`  productos con PDF propio:     ${r.productosConObjetoPropio}`)
}

function leerPlan(a: Args): PlanFichasR2 {
  const dir = exigir(a.dir, "--dir <carpeta>")
  const tenant = exigir(a.tenant, "--tenant <id>")
  const plan = JSON.parse(readFileSync(join(dir, "plan-r2.json"), "utf8")) as PlanFichasR2
  if (plan.tenant !== tenant) throw new Error(`El plan es del tenant ${plan.tenant}, no de ${tenant}. Vuelva a planificar.`)
  return plan
}

async function verificarBase(tenant: string): Promise<void> {
  const { sql } = await import("drizzle-orm")
  const { getDb } = await import("../src/db")
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "")
  console.log(`base: ${/localhost|127\.0\.0\.1/.test(host) ? "LOCAL" : "REMOTA"}`)
  const filas = (await getDb().execute(sql`select id from tenants where id = ${tenant}`)) as unknown as { id: string }[]
  if (filas.length === 0) throw new Error(`El tenant ${JSON.stringify(tenant)} no existe en esta base.`)
}

async function aplicar(a: Args): Promise<void> {
  const plan = leerPlan(a)
  const tenant = plan.tenant
  await verificarBase(tenant)
  const { getShopMediaR2 } = await import("../src/lib/shop-media")
  const repo = await import("../src/lib/catalogo-ficha-repo")
  const r2 = getShopMediaR2()
  if (a.ejecutar && !r2) throw new Error("Falta la configuración del bucket de archivos (R2_SHOP_MEDIA_*).")
  if (!r2) console.log("sin R2 configurado: el dry-run no verifica qué objetos ya existen en el bucket")

  const r = await aplicarPlan(
    plan,
    { ejecutar: a.ejecutar, limite: a.limite, productos: a.productos.length ? a.productos : undefined },
    {
      leerFicha: (t, id) => repo.leerFichaDeProducto(t, id),
      cambiarSiVigente: (t, id, vigente, nueva) => repo.cambiarFichaSiVigente(t, id, vigente, nueva, UPDATED_BY),
      r2,
      leerPdf: async (archivo) => new Uint8Array(readFileSync(join(exigir(a.dir, "--dir"), "pdfs", archivo))),
      log: console.log,
    },
  )
  console.log(a.ejecutar ? "APLICADO" : "DRY-RUN (sin --ejecutar no se subió ni cambió nada)", {
    ...r,
    errores: r.errores.length,
    bytesSubidos: mb(r.bytesSubidos),
  })
  for (const e of r.errores.slice(0, 20)) console.log(`  error ${e.id}: ${e.motivo}`)
  if (a.ejecutar && r.actualizados > 0) {
    const { avisarShop } = await import("../src/lib/aviso-shop")
    const { propagado } = await avisarShop(tenant)
    console.log(`aviso al Shop: ${propagado ? "entregado" : "no entregado (el cambio igual ya está en la base)"}`)
  }
}

async function revertir(a: Args): Promise<void> {
  const plan = leerPlan(a)
  await verificarBase(plan.tenant)
  const { getShopMediaR2 } = await import("../src/lib/shop-media")
  const repo = await import("../src/lib/catalogo-ficha-repo")
  const r2 = getShopMediaR2()
  if (!r2) throw new Error("Falta la configuración del bucket de archivos (R2_SHOP_MEDIA_*).")
  const r = await revertirPlan(
    plan,
    { ejecutar: a.ejecutar, limite: a.limite, productos: a.productos.length ? a.productos : undefined },
    {
      leerFicha: (t, id) => repo.leerFichaDeProducto(t, id),
      cambiarSiVigente: (t, id, vigente, nueva) => repo.cambiarFichaSiVigente(t, id, vigente, nueva, UPDATED_BY),
      r2,
      log: console.log,
    },
  )
  console.log(a.ejecutar ? "REVERTIDO" : "DRY-RUN del revertir", r)
  if (a.ejecutar && r.revertidos > 0) {
    const { avisarShop } = await import("../src/lib/aviso-shop")
    await avisarShop(plan.tenant)
  }
}

async function huerfanos(a: Args): Promise<void> {
  const tenant = exigir(a.tenant, "--tenant <id>")
  await verificarBase(tenant)
  const repo = await import("../src/lib/catalogo-ficha-repo")
  const lista = calcularRespaldosSinUso(await repo.listarFichas(tenant))
  const bytes = lista.reduce((n, o) => n + o.bytes, 0)
  for (const o of lista) console.log(`${o.key}\t${o.bytes}\t${o.productos}`)
  console.log(`\n${lista.length} copias viejas sin uso (${mb(bytes)}). NO se borró nada.`)
  console.log("Borrarlas deja sin efecto el `revertir` de esos productos: hacerlo sólo con OK explícito.")
}

async function main() {
  const a = leerArgs(process.argv.slice(2))
  if (a.comando === "planificar") return planificar(a)
  if (a.comando === "aplicar") return aplicar(a)
  if (a.comando === "revertir") return revertir(a)
  if (a.comando === "huerfanos") return huerfanos(a)
  throw new Error("Uso: fichas-catalogo.ts planificar|aplicar|revertir|huerfanos --dir <dir> --tenant <id> [--ejecutar] [--limite N] [--producto ID]")
}

main()
  .catch((err) => {
    console.error("ERROR:", err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    if (process.env.DATABASE_URL) {
      const { getDb } = await import("../src/db")
      await (getDb() as unknown as { $client: { end: () => Promise<void> } }).$client.end()
    }
  })
