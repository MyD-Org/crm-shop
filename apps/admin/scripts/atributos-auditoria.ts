/**
 * Auditoría SOLO LECTURA de `public.catalog_atributos` (no escribe nada en ninguna base).
 *
 *   a) Filas fuera del rango plausible de su clave (`RANGOS_PLAUSIBLES`): alegra_id, nombre, valor y
 *      fuente. Sirve para encontrar rarezas (potencia 30000 W, flujo 60000 lm, tensión 2 V, IP 0).
 *   b) Productos publicados cuyo NOMBRE es el de un cable y no tienen `seccion_mm2`, con el valor que
 *      sacaría hoy el extractor del nombre (null = tampoco lo lee).
 *
 * Los detalles (con ids y nombres de productos) van a un archivo LOCAL bajo `tmp/` (ignorado por git:
 * el repo es público); la consola muestra sólo conteos.
 *
 *   DATABASE_URL="<conexión de la base>" npx tsx scripts/atributos-auditoria.ts --tenant <id> \
 *     [--universo publicados|activos|todos] [--salida tmp/atributos-auditoria.json]
 *
 * "publicados" = producto activo, con fila de overlay visible y con stock (o sin stock informado):
 * una aproximación del universo del Shop (no mira el precio). Sin DATABASE_URL usa la base local.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { and, eq } from "drizzle-orm"
import { getDb } from "../src/db"
import { catalogAtributos, catalogOverlay, catalogProducts } from "../src/db/schema"
import {
  cablesSinSeccion,
  contarFueraDeRango,
  fueraDeRango,
  type FilaAuditada,
  type ProductoAuditado,
} from "../src/lib/catalogo-atributos-auditoria"

type Universo = "publicados" | "activos" | "todos"

function valor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const tenant = valor(argv, "--tenant")
  if (!tenant) throw new Error("Falta --tenant <id>")
  const universo = (valor(argv, "--universo") ?? "publicados") as Universo
  if (!["publicados", "activos", "todos"].includes(universo)) throw new Error("--universo: publicados | activos | todos")
  const salida = resolve(valor(argv, "--salida") ?? "tmp/atributos-auditoria.json")

  const db = getDb()
  const productosTodos = await db
    .select({
      alegraId: catalogProducts.alegraId,
      name: catalogProducts.name,
      description: catalogProducts.description,
      status: catalogProducts.status,
      stock: catalogProducts.stock,
      visible: catalogOverlay.visible,
    })
    .from(catalogProducts)
    .leftJoin(
      catalogOverlay,
      and(eq(catalogOverlay.tenantId, catalogProducts.tenantId), eq(catalogOverlay.alegraId, catalogProducts.alegraId)),
    )
    .where(eq(catalogProducts.tenantId, tenant))

  const publicado = (p: (typeof productosTodos)[number]) =>
    p.status === "active" && p.visible === true && (p.stock == null || Number(p.stock) > 0)
  const productos: (ProductoAuditado & { activo: boolean })[] = productosTodos.map((p) => ({
    alegraId: p.alegraId,
    name: p.name,
    description: p.description,
    publicado: publicado(p),
    activo: p.status === "active",
  }))
  const enUniverso = (p: { publicado: boolean; activo: boolean }) =>
    universo === "todos" ? true : universo === "activos" ? p.activo : p.publicado
  const porId = new Map(productos.map((p) => [p.alegraId, p]))

  const filasDb = await db.select().from(catalogAtributos).where(eq(catalogAtributos.tenantId, tenant))
  const filas: FilaAuditada[] = filasDb.map((f) => ({
    alegraId: f.alegraId,
    clave: f.clave,
    valorNum: f.valorNum != null ? Number(f.valorNum) : null,
    valorTexto: f.valorTexto,
    fuente: f.fuente,
    nombre: porId.get(f.alegraId)?.name ?? "(producto fuera del espejo)",
    publicado: porId.get(f.alegraId)?.publicado ?? false,
  }))

  const rango = fueraDeRango(filas.filter((f) => universo === "todos" || (porId.get(f.alegraId) && enUniverso(porId.get(f.alegraId)!))))
  const universoProductos = productos.filter(enUniverso)
  const conSeccion = new Set(filas.filter((f) => f.clave === "seccion_mm2").map((f) => f.alegraId))
  const cables = cablesSinSeccion(universoProductos, conSeccion)

  mkdirSync(dirname(salida), { recursive: true })
  writeFileSync(
    salida,
    JSON.stringify(
      {
        generado: new Date().toISOString(),
        tenant,
        universo,
        fueraDeRango: rango.map((h) => ({
          alegraId: h.alegraId,
          clave: h.clave,
          valor: h.valorNum,
          fuente: h.fuente,
          nombre: h.nombre,
          rangoPlausible: [h.min, h.max],
          publicado: h.publicado,
        })),
        cablesSinSeccion: cables,
      },
      null,
      2,
    ),
  )

  console.log(`tenant=${tenant} universo=${universo} productos=${universoProductos.length} filas=${filas.length}`)
  console.log(`(a) filas fuera de rango plausible: ${rango.length} ${JSON.stringify(contarFueraDeRango(rango))}`)
  console.log(
    `(b) cables sin seccion_mm2: ${cables.length} (el extractor lee el valor en ${cables.filter((c) => c.seccionDelNombre != null).length}, ` +
      `no lo lee en ${cables.filter((c) => c.seccionDelNombre == null).length})`,
  )
  console.log(`detalle en ${salida} (tmp/ no se commitea)`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
