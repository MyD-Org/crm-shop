import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  contarSeleccion,
  detalleProducto,
  guardarOverlay,
  listarProductos,
  masivaOverlay,
  resolverAncla,
} from "@/lib/catalogo-overlay-repo"
import { recalcularGrupos, sumarAGrupo } from "@/lib/catalogo-variantes-repo"
import { seedTenant, truncateAll } from "./helpers"

// Panel de catálogo agrupado por modelo (change `variantes-de-producto`, S4): el listado pagina por
// unidad (un modelo = una fila), las variantes viajan en lote, y el overlay del grupo es el del ancla.
// DB real (crm_test). Datos inventados.

const T = "tenant-grp"
const OTRO = "tenant-otro"

interface Fila {
  id: string
  nombre?: string
  tipo?: "simple" | "padre" | "variante"
  padre?: string | null
  opcion?: string | null
  stock?: number | null
  precio?: number | null
  tenant?: string
  alegraStatus?: string
}

async function sembrar(f: Fila) {
  const precios = f.precio ? JSON.stringify([{ idPriceList: "1", name: "General", price: f.precio }]) : "[]"
  const variante = f.opcion ? JSON.stringify([{ atributo: "Color", opcion: f.opcion }]) : null
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, variante, stock, status, alegra_status, prices, precios_online)
    VALUES (${f.tenant ?? T}, ${f.id}, ${f.nombre ?? "Producto " + f.id}, ${f.tipo ?? "simple"}, ${f.padre ?? null}, ${variante}::jsonb,
            ${f.stock ?? null}, 'active', ${f.alegraStatus ?? "active"}, ${precios}::jsonb, ${precios}::jsonb)
  `)
}

/** Un modelo: padre + N variantes con precio y stock. */
async function modelo(padre: string, nombre: string, opciones: string[], tenant = T) {
  await sembrar({ id: padre, nombre, tipo: "padre", tenant })
  for (const [i, opcion] of opciones.entries()) {
    await sembrar({ id: `${padre}-${i + 1}`, nombre: `${nombre} / ${opcion}`, tipo: "variante", padre, opcion, precio: 100 + i, stock: 5, tenant })
  }
}

const listar = (filtros = {}, opciones = {}) => listarProductos(T, filtros, opciones)

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})

afterAll(async () => {
  await truncateAll()
})

describe("listarProductos agrupa por modelo", () => {
  it("un modelo con tres variantes es UNA fila con sus variantes anidadas", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo", "Azul"])
    await sembrar({ id: "suelto", nombre: "Lámpara", precio: 50, stock: 1 })
    await recalcularGrupos(T)

    const { items, total } = await listar()
    expect(total).toBe(2)
    expect(items.map((i) => i.alegraId).sort()).toEqual(["M1", "suelto"])

    const m = items.find((i) => i.alegraId === "M1")!
    expect(m).toMatchObject({ tipo: "padre", esAncla: true, grupoId: null })
    expect(m.variantes.map((v) => v.etiqueta)).toEqual(["Azul", "Rojo", "Verde"])
    expect(m.variantes[0]).toMatchObject({ tipo: "variante", manual: false, esAncla: false, status: "active" })
    expect(m.variantes.filter((v) => v.esRepresentante)).toHaveLength(1)

    const s = items.find((i) => i.alegraId === "suelto")!
    expect(s).toMatchObject({ tipo: "simple", esAncla: false, variantes: [] })
  })

  it("el total y la paginación cuentan modelos, no variantes", async () => {
    await modelo("M1", "Cinta A", ["Verde", "Rojo", "Azul"])
    await modelo("M2", "Cinta B", ["Verde", "Rojo", "Azul"])
    await sembrar({ id: "suelto", nombre: "Lámpara", precio: 50, stock: 1 })
    await recalcularGrupos(T)

    const p1 = await listar({}, { start: 0, limit: 2 })
    const p2 = await listar({}, { start: 2, limit: 2 })
    expect(p1.total).toBe(3)
    expect(p1.items).toHaveLength(2)
    expect(p2.items).toHaveLength(1)
    expect([...p1.items, ...p2.items].map((i) => i.alegraId).sort()).toEqual(["M1", "M2", "suelto"])
  })

  it("con los filtros de precio y stock el modelo aparece aunque el padre no tenga precio ni stock", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await recalcularGrupos(T)
    const { items, total } = await listar({ precio: "con", stock: "con", alegra: "active" })
    expect(total).toBe(1)
    expect(items[0].alegraId).toBe("M1")
    // Y las variantes viajan todas, hayan coincidido con el filtro o no.
    expect(items[0].variantes).toHaveLength(2)
  })

  it("un modelo cuyas variantes no cumplen el filtro no aparece", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await recalcularGrupos(T)
    expect((await listar({ stock: "sin" })).total).toBe(0)
  })

  it("la búsqueda encuentra el modelo por el nombre del modelo o por el de una opción", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await modelo("M2", "Panel", ["Blanco cálido", "Blanco frío"])
    await recalcularGrupos(T)

    expect((await listar({ q: "Cinta" })).items.map((i) => i.alegraId)).toEqual(["M1"])
    expect((await listar({ q: "blanco calido" })).items.map((i) => i.alegraId)).toEqual(["M2"])
    expect((await listar({ q: "verde" })).items.map((i) => i.alegraId)).toEqual(["M1"])

    // El nombre propio del grupo (overlay del ancla) también se busca.
    await guardarOverlay(T, "M2", { nombre: "Luminaria de techo" })
    expect((await listar({ q: "luminaria" })).items.map((i) => i.alegraId)).toEqual(["M2"])
  })

  it("los filtros del overlay se evalúan sobre el overlay del ANCLA", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await sembrar({ id: "suelto", precio: 10, stock: 1 })
    await recalcularGrupos(T)
    await guardarOverlay(T, "M1", { visible: true })

    expect((await listar({ estado: "visible" })).items.map((i) => i.alegraId)).toEqual(["M1"])
    expect((await listar({ estado: "oculto" })).items.map((i) => i.alegraId)).toEqual(["suelto"])
  })

  it("la foto propia de una variante viaja con la variante; el overlay del modelo, con el modelo", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await recalcularGrupos(T)
    await guardarOverlay(T, "M1-1", { fotos: [{ key: `productos/${T}/M1-1/f1-320.webp`, w: 320 }] })
    await guardarOverlay(T, "M1", { fotos: [{ key: `productos/${T}/M1/base-320.webp`, w: 320 }] })

    const { items } = await listar()
    expect(items[0].fotos.map((f) => f.key)).toEqual([`productos/${T}/M1/base-320.webp`])
    const propia = items[0].variantes.find((v) => v.alegraId === "M1-1")!
    expect(propia.fotos.map((f) => f.key)).toEqual([`productos/${T}/M1-1/f1-320.webp`])
    expect(items[0].variantes.find((v) => v.alegraId === "M1-2")!.fotos).toEqual([])
  })

  it("el padre informa por qué el MODELO no se publica, mirando a sus variantes", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await recalcularGrupos(T)

    expect((await listar()).items[0].motivos).toEqual(["oculto"])
    await guardarOverlay(T, "M1", { visible: true })
    expect((await listar()).items[0].motivos).toEqual([])

    await getDb().execute(sql`UPDATE catalog_products SET prices = '[]'::jsonb WHERE tenant_id = ${T} AND tipo = 'variante'`)
    expect((await listar()).items[0].motivos).toEqual(["sin_precio"])

    await getDb().execute(sql`UPDATE catalog_products SET alegra_status = 'inactive' WHERE tenant_id = ${T} AND tipo = 'variante'`)
    expect((await listar()).items[0].motivos).toEqual(["inactivo_en_alegra", "sin_precio"])
  })

  it("nunca mezcla tenants", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await modelo("M9", "Cinta ajena", ["Verde", "Rojo"], OTRO)
    await recalcularGrupos(T)
    await recalcularGrupos(OTRO)
    const { items, total } = await listar()
    expect(total).toBe(1)
    expect(items[0].variantes.every((v) => v.alegraId.startsWith("M1"))).toBe(true)
    expect((await listarProductos(OTRO, {})).items.map((i) => i.alegraId)).toEqual(["M9"])
  })

  it("un grupo armado a mano: la base es la fila, los sumados son sus variantes (con 'manual' y 'orden')", async () => {
    await sembrar({ id: "A", nombre: "Cinta blanca", precio: 100, stock: 2 })
    await sembrar({ id: "B", nombre: "Cinta RGB", precio: 180, stock: 2 })
    await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "RGB", orden: 3, etiquetaAncla: "Blanca" }, null)

    const { items, total } = await listar()
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({ alegraId: "A", tipo: "simple", esAncla: true, grupoId: "A" })
    expect(items[0].variantes.map((v) => [v.alegraId, v.etiqueta, v.manual, v.esAncla])).toEqual([
      ["A", "Blanca", true, true],
      ["B", "RGB", true, false],
    ])
    expect(items[0].variantes[1].orden).toBe(3)
  })

  it("el stock por sucursal de las variantes viaja en la misma tanda", async () => {
    await modelo("M1", "Cinta LED", ["Verde"])
    await recalcularGrupos(T)
    await getDb().execute(sql`
      INSERT INTO sucursales (tenant_id, slug, nombre) VALUES (${T}, 'igz', 'Sucursal IGZ') ON CONFLICT DO NOTHING
    `)
    await getDb().execute(sql`
      INSERT INTO catalog_stock_sucursal (tenant_id, alegra_id, sucursal, stock, origen) VALUES (${T}, 'M1-1', 'igz', 7, 'sync')
    `)
    const { items } = await listar()
    expect(items[0].variantes[0].stockSucursales).toEqual([expect.objectContaining({ sucursal: "igz", stock: "7" })])
  })
})

describe("detalleProducto y resolverAncla", () => {
  it("la ficha de un padre trae su modelo; la de una variante dice a qué grupo pertenece", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await recalcularGrupos(T)

    const padre = (await detalleProducto(T, "M1"))!
    expect(padre).toMatchObject({ tipo: "padre", esAncla: true })
    expect(padre.variantes).toHaveLength(2)

    const hija = (await detalleProducto(T, "M1-1"))!
    expect(hija).toMatchObject({ tipo: "variante", grupoId: "M1", etiqueta: "Verde", esAncla: false, variantes: [] })

    expect(await detalleProducto(OTRO, "M1")).toBeNull()
  })

  it("resolverAncla: suelto, padre, variante agrupada, base de grupo manual, miembro manual y otro tenant", async () => {
    await modelo("M1", "Cinta LED", ["Verde"])
    await sembrar({ id: "suelto", precio: 10, stock: 1 })
    await sembrar({ id: "A", precio: 10, stock: 1 })
    await sembrar({ id: "B", precio: 10, stock: 1 })
    await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "B", etiquetaAncla: "A" }, null)
    await recalcularGrupos(T)

    expect(await resolverAncla(T, "suelto")).toMatchObject({ anclaId: "suelto", agrupada: false, grupoId: null })
    expect(await resolverAncla(T, "M1")).toMatchObject({ anclaId: "M1", tipo: "padre", agrupada: false })
    expect(await resolverAncla(T, "M1-1")).toMatchObject({ anclaId: "M1", agrupada: true, grupoId: "M1" })
    expect(await resolverAncla(T, "A")).toMatchObject({ anclaId: "A", agrupada: false, grupoId: "A" })
    expect(await resolverAncla(T, "B")).toMatchObject({ anclaId: "A", agrupada: true })
    expect(await resolverAncla(OTRO, "M1")).toBeNull()
  })
})

describe("acciones masivas por filtro actúan sobre el modelo (ancla), no sobre cada variante", () => {
  it("cuenta modelos y escribe el overlay SOLO en el ancla", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo", "Azul"])
    await sembrar({ id: "suelto", nombre: "Lámpara", precio: 10, stock: 1 })
    await recalcularGrupos(T)

    expect(await contarSeleccion(T, { tipo: "filtro", filtros: { q: "Cinta" } })).toBe(1)
    expect(await contarSeleccion(T, { tipo: "filtro", filtros: {} })).toBe(2)

    const r = await masivaOverlay(T, { tipo: "filtro", filtros: { q: "Cinta" } }, { tipo: "visible", valor: true })
    expect(r).toEqual({ kind: "ok", afectados: 1 })
    const overlays = (await getDb().execute(sql`SELECT alegra_id FROM catalog_overlay WHERE tenant_id = ${T}`)) as unknown as { alegra_id: string }[]
    expect(overlays.map((o) => o.alegra_id)).toEqual(["M1"])
  })

  it("'excluir' saca el modelo entero", async () => {
    await modelo("M1", "Cinta LED", ["Verde", "Rojo"])
    await sembrar({ id: "suelto", precio: 10, stock: 1 })
    await recalcularGrupos(T)
    expect(await contarSeleccion(T, { tipo: "filtro", filtros: {}, excluir: ["M1"] })).toBe(1)
  })
})
