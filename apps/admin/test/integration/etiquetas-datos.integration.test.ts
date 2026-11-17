import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listarProductos } from "@/lib/catalogo-overlay-repo"
import { parsearQueryListado, validarStockEn } from "@/lib/catalogo-admin"
import { armarContexto } from "@/lib/etiquetas-repo"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Datos de la pantalla de etiquetas (change `etiquetas-desde-crm`, R3): filtro `marca` del listado
// (sin distinguir mayúsculas), stock por sucursal sin cruzar tenants y contexto de la tienda.
// Datos inventados.

const A = "tenant-a"
const B = "tenant-b"
const PRECIO = '[{"idPriceList":"1","name":"General","price":100}]'

async function producto(tenant: string, id: string, brand: string | null) {
  await getDb().execute(
    sql`INSERT INTO catalog_products (tenant_id, alegra_id, code, name, brand, prices, stock) VALUES (${tenant}, ${id}, ${"C" + id}, ${"Producto " + id}, ${brand}, ${PRECIO}::jsonb, 5)`,
  )
}

const ids = async (tenant: string, filtros: Parameters<typeof listarProductos>[1]) =>
  (await listarProductos(tenant, filtros, { limit: 200 })).items.map((i) => i.alegraId).sort()

beforeEach(async () => {
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, catalog_overlay, catalog_stock_sucursal restart identity cascade`)
  await seedTenant(A)
  await seedTenant(B)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(B, { slug: "ajena", nombre: "Ajena" })
  await producto(A, "1", "ACME")
  await producto(A, "2", " acme ")
  await producto(A, "3", "OTRA")
  await producto(A, "4", null)
  await producto(B, "1", "ACME")
  await getDb().execute(
    sql`INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, stock, origen, leido_at) VALUES (${B}, 'ajena', '1', 9, 'sync', now())`,
  )
})

afterAll(async () => {
  await truncateAll()
})

describe("filtro marca del listado", () => {
  it("no distingue mayúsculas ni espacios: «acme» y «ACME» traen lo mismo", async () => {
    expect(await ids(A, { marca: "acme" })).toEqual(["1", "2"])
    expect(await ids(A, { marca: "ACME" })).toEqual(["1", "2"])
  })

  it("otra marca no entra y sin marca vuelve todo", async () => {
    expect(await ids(A, { marca: "otra" })).toEqual(["3"])
    expect(await ids(A, {})).toEqual(["1", "2", "3", "4"])
  })

  it("la misma marca de otro tenant no aparece", async () => {
    const { items } = await listarProductos(B, { marca: "acme" }, { limit: 200 })
    expect(items.map((i) => i.alegraId)).toEqual(["1"])
  })
})

describe("stock por sucursal: sin cruzar tenants", () => {
  it("una sucursal de otro tenant en stockEn se rechaza y no filtra datos ajenos", async () => {
    const parsed = parsearQueryListado(new URL("http://x/?stockEn=ajena"))
    if (parsed instanceof Response) throw new Error("no debería fallar el parseo")
    const res = await validarStockEn(A, parsed.filtros)
    expect(res?.status).toBe(400)
    expect(await res?.json()).toMatchObject({ error: "La sucursal del filtro de stock no existe" })
    // Aun si se saltea la validación, el EXISTS ata el stock al tenant del producto.
    expect(await ids(A, { stockEn: "ajena" })).toEqual([])
  })

  it("el stock de las filas es sólo el del tenant", async () => {
    const { items } = await listarProductos(A, {}, { limit: 200 })
    expect(items.flatMap((i) => i.stockSucursales)).toEqual([])
  })
})

describe("armarContexto", () => {
  it("devuelve sólo las sucursales y marcas del tenant pedido", async () => {
    const a = await armarContexto(A, {})
    expect(a.sucursales.map((s) => s.slug)).toEqual(["igz"])
    expect(a.marcas.map((m) => m.clave)).toEqual(["acme", "otra"])
    const b = await armarContexto(B, {})
    expect(b.sucursales.map((s) => s.slug)).toEqual(["ajena"])
    expect(b.marcas.map((m) => m.clave)).toEqual(["acme"])
  })

  it("sin URL de Shop ni env de respaldo, shopUrl es null", async () => {
    const a = await armarContexto(A, { SHOP_TENANT_LEGACY: "otro" })
    expect(a.tenant.shopUrl).toBeNull()
  })

  it("con env histórico para el tenant, shopUrl sale de la función de URL pública", async () => {
    const a = await armarContexto(A, { NEXT_PUBLIC_SHOP_URL: "https://tienda.cliente.example/" })
    expect(a.tenant.shopUrl).toBe("https://tienda.cliente.example")
  })
})
