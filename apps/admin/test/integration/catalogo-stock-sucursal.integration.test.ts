import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { detalleProducto, listarProductos } from "@/lib/catalogo-overlay-repo"
import { parsearQueryListado, parsearSeleccion, validarStockEn } from "@/lib/catalogo-admin"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Stock por sucursal en el listado y filtro "Con stock en" del panel de catálogo (change
// `sucursales-igz-mdp`). Datos inventados.

const A = "tenant-a" // dos sucursales
const B = "tenant-b" // una sola
const PRECIO = '[{"idPriceList":"1","name":"General","price":100}]'

const ids = async (filtros: Parameters<typeof listarProductos>[1]) =>
  (await listarProductos(A, filtros, { limit: 200 })).items.map((i) => i.alegraId).sort()

async function stock(tenant: string, sucursal: string, alegraId: string, valor: number) {
  await getDb().execute(
    sql`INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, stock, origen, leido_at) VALUES (${tenant}, ${sucursal}, ${alegraId}, ${valor}, 'sync', now())`,
  )
}

beforeEach(async () => {
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, catalog_overlay, catalog_stock_sucursal restart identity cascade`)
  await seedTenant(A)
  await seedTenant(B)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await crearSucursal(B, { slug: "unica", nombre: "Única" })
  for (const [t, id] of [[A, "1"], [A, "2"], [A, "3"], [B, "1"]]) {
    await getDb().execute(
      sql`INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock) VALUES (${t}, ${id}, ${"C" + id}, ${"Producto " + id}, ${PRECIO}::jsonb, 5)`,
    )
  }
  // 1: stock en las dos. 2: solo en igz (mdp en 0). 3: sin filas.
  await stock(A, "igz", "1", 12)
  await stock(A, "mdp", "1", 3)
  await stock(A, "igz", "2", 7)
  await stock(A, "mdp", "2", 0)
  await stock(B, "unica", "1", 9)
})

afterAll(async () => {
  await truncateAll()
})

describe("stock por sucursal en el listado", () => {
  it("cada fila trae el stock de sus sucursales (sin fila = ausente)", async () => {
    const { items } = await listarProductos(A, {}, { limit: 200 })
    const de = (id: string) => items.find((i) => i.alegraId === id)!.stockSucursales.map((s) => [s.sucursal, Number(s.stock)])
    expect(de("1")).toEqual([["igz", 12], ["mdp", 3]])
    expect(de("2")).toEqual([["igz", 7], ["mdp", 0]])
    expect(de("3")).toEqual([])
    expect(items[0].stockSucursales[0].leidoAt).toEqual(expect.any(String))
  })

  it("no mezcla tenants: el tenant de una sola sucursal ve solo la suya", async () => {
    const { items } = await listarProductos(B, {}, { limit: 200 })
    expect(items).toHaveLength(1)
    expect(items[0].stockSucursales.map((s) => s.sucursal)).toEqual(["unica"])
  })

  it("la ficha también trae el stock por sucursal", async () => {
    const d = await detalleProducto(A, "1")
    expect(d?.stockSucursales.map((s) => s.sucursal)).toEqual(["igz", "mdp"])
  })

  it("una página vacía no consulta ni rompe", async () => {
    const r = await listarProductos(A, { q: "no-existe" })
    expect(r.items).toEqual([])
  })
})

describe("filtro stockEn (Con stock en)", () => {
  it("deja solo los productos con stock mayor a cero en esa sucursal", async () => {
    expect(await ids({ stockEn: "igz" })).toEqual(["1", "2"])
    expect(await ids({ stockEn: "mdp" })).toEqual(["1"])
  })

  it("«con stock» y «sin stock» miran cualquier sucursal, no solo la cuenta de origen", async () => {
    // Repetido con 0 en la principal y stock en otra sucursal (las pantallas de MDP): tiene stock.
    await getDb().execute(sql`UPDATE catalog_products SET stock = 0 WHERE tenant_id = ${A} AND alegra_id IN ('1', '3')`)
    expect(await ids({ stock: "con" })).toEqual(["1", "2"])
    expect(await ids({ stock: "sin" })).toEqual(["3"])
  })

  it("sin filtro lista todo", async () => {
    expect(await ids({})).toEqual(["1", "2", "3"])
  })

  it("se combina con los demás filtros", async () => {
    expect(await ids({ stockEn: "igz", q: "Producto 2" })).toEqual(["2"])
  })

  it("el parser valida el formato y el tenant valida la existencia (400)", async () => {
    const ok = parsearQueryListado(new URL("http://x/?stockEn=mdp"))
    expect(ok instanceof Response ? null : ok.filtros.stockEn).toBe("mdp")
    const malo = parsearQueryListado(new URL("http://x/?stockEn=MD P"))
    expect(malo instanceof Response && malo.status).toBe(400)

    expect(await validarStockEn(A, { stockEn: "mdp" })).toBeNull()
    expect(await validarStockEn(A, {})).toBeNull()
    const inexistente = await validarStockEn(A, { stockEn: "zzz" })
    expect(inexistente?.status).toBe(400)
    // "unica" existe, pero en el OTRO tenant.
    expect((await validarStockEn(A, { stockEn: "unica" }))?.status).toBe(400)
  })

  it("el descriptor de una masiva acepta stockEn", () => {
    const s = parsearSeleccion({ seleccion: { tipo: "filtro", filtros: { stockEn: "mdp" } } })
    expect(s instanceof Response ? null : s.tipo === "filtro" ? s.filtros.stockEn : null).toBe("mdp")
  })
})
