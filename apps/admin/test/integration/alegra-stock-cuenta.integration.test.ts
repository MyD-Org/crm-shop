import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraProduct } from "@/lib/alegra"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Webhooks de stock por cuenta (change `sucursales-igz-mdp`, rebanada D, D2) contra Postgres real
// (crm_test) con el cliente de Alegra mockeado: cada cuenta se distingue por su token. Datos
// inventados: tenant-a, cuentas `principal` (Iguazú) y `mdp`.

type Vivo = AlegraProduct | null
const vivos: Record<string, Record<string, Vivo>> = { "tok-igz": {}, "tok-mdp": {} }
const lecturas: { token: string; id: string }[] = []

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  getItemParaEspejo: async (cfg: { alegraToken: string }, id: string) => {
    lecturas.push({ token: cfg.alegraToken, id })
    return vivos[cfg.alegraToken]?.[id] ?? null
  },
}))
const { avisarShopMock } = vi.hoisted(() => ({ avisarShopMock: vi.fn() }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: avisarShopMock }))

const { drenarTenant } = await import("@/lib/alegra-stock-cola")
const { registrarAviso } = await import("@/lib/alegra-stock-webhook")

const A = "tenant-a"
const base = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as Parameters<typeof drenarTenant>[0]
const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (q: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(q))] as Fila[]

const item = (id: string, code: string | null, stock: number | null, over: Partial<AlegraProduct> = {}): AlegraProduct => ({
  alegraId: id,
  code,
  name: `Producto ${code ?? id}`,
  description: null,
  categoryAlegraId: null,
  prices: [{ idPriceList: "9", name: "general", price: 800 }],
  stock,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: 21,
  raw: { id, price: [{ idPriceList: "9", name: "general", price: 800 }] },
  ...over,
})

async function drenar() {
  return drenarTenant(base, { deadline: Date.now() + 60_000, ritmoMs: 0, dormir: async () => {} })
}
async function encolarDeCuenta(ids: string[], slug = "mdp") {
  for (const id of ids) {
    await registrarAviso(A, "edit-item", { subject: "edit-item", message: { item: { id } } }, slug)
  }
}
const producto = async (alegraId: string) => (await filas(sql`SELECT * FROM catalog_products WHERE tenant_id = ${A} AND alegra_id = ${alegraId}`))[0]
const css = async (sucursal: string, alegraId: string) =>
  (await filas(sql`SELECT * FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = ${sucursal} AND alegra_id = ${alegraId}`))[0]
const cola = async () => (await filas(sql`SELECT alegra_id FROM alegra_item_refresh WHERE tenant_id = ${A} ORDER BY alegra_id`)).map((f) => f.alegra_id)

async function sembrarProducto(alegraId: string, code: string | null, over: { cuentaId?: string; alegraIdCuenta?: string; status?: string; alegraStatus?: string | null; stock?: number; categoria?: string } = {}) {
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, alegra_status, stock, cuenta_id, alegra_id_cuenta, category_alegra_id)
    VALUES (${A}, ${alegraId}, ${code}, ${`Producto ${code ?? alegraId}`}, ${over.status ?? "active"}, ${over.alegraStatus ?? null},
            ${over.stock ?? 10}, ${over.cuentaId ?? null}::uuid, ${over.alegraIdCuenta ?? null}, ${over.categoria ?? null})
  `)
}
async function sembrarStock(sucursal: string, alegraId: string, itemIdCuenta: string | null, stock = 5) {
  await db().execute(sql`
    INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen)
    VALUES (${A}, ${sucursal}, ${alegraId}, ${itemIdCuenta}, ${stock}, 'sync')
  `)
}

let idMdp: string

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_categories, catalog_stock_sucursal, alegra_cuentas, alegra_item_refresh, alegra_documento_items, alegra_webhook_avisos, catalog_overlay restart identity cascade`)
  vivos["tok-igz"] = {}
  vivos["tok-mdp"] = {}
  lecturas.length = 0
  avisarShopMock.mockReset()
  avisarShopMock.mockResolvedValue({ propagado: true })
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'mdp@cliente.example', 'tok-mdp')`)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE slug = 'mdp'`)
  ;[{ id: idMdp }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'`)) as { id: string }[]
})

afterAll(async () => {
  await truncateAll()
})

describe("registrar el aviso de una cuenta secundaria", () => {
  it("los ítems entran a la cola con el prefijo de la cuenta y no tocan los ids de la principal", async () => {
    const r = await registrarAviso(A, "edit-item", { subject: "edit-item", message: { item: { id: 500 } } }, "mdp")
    expect(r).toMatchObject({ accion: "encolado", encolados: 1 })
    expect(await cola()).toEqual(["mdp:500"])
    // Y el mismo id numérico en la principal es OTRA fila.
    await registrarAviso(A, "edit-item", { subject: "edit-item", message: { item: { id: 500 } } })
    expect(await cola()).toEqual(["500", "mdp:500"])
  })

  it("el índice documento→ítems se separa por cuenta (los ids de documento se pueden repetir)", async () => {
    const doc = (items: number[]) => ({ subject: "new-invoice", message: { invoice: { id: "10", status: "open", items: items.map((id) => ({ id })) } } })
    await registrarAviso(A, "new-invoice", doc([1]), "mdp")
    await registrarAviso(A, "new-invoice", doc([2]))
    const idx = await filas(sql`SELECT alegra_doc_id, item_ids FROM alegra_documento_items WHERE tenant_id = ${A} ORDER BY alegra_doc_id`)
    expect(idx).toEqual([
      { alegra_doc_id: "10", item_ids: ["2"] },
      { alegra_doc_id: "mdp:10", item_ids: ["mdp:1"] },
    ])
  })

  it("el contador de avisos distingue la cuenta (para notar que dejaron de llegar)", async () => {
    await registrarAviso(A, "new-item", { subject: "new-item", message: { item: { id: 1 } } }, "mdp")
    const c = await filas(sql`SELECT evento FROM alegra_webhook_avisos WHERE tenant_id = ${A}`)
    expect(c).toEqual([{ evento: "mdp:new-item" }])
  })
})

describe("drenar ítems de una cuenta secundaria", () => {
  it("PAREADO: actualiza solo el stock de la sucursal, con las credenciales de MDP", async () => {
    await sembrarProducto("100", "LED-1", { stock: 10 })
    await sembrarStock("igz", "100", "100", 10)
    await sembrarStock("mdp", "100", "500", 5)
    vivos["tok-mdp"]["500"] = item("500", "LED-1", 7, { name: "Nombre de MDP que NO debe pisar" })
    await encolarDeCuenta(["500"])
    const r = await drenar()
    expect(r).toMatchObject({ leidos: 1, errores: 0, corte: "vacia" })
    expect(lecturas).toEqual([{ token: "tok-mdp", id: "500" }])
    expect(await css("mdp", "100")).toMatchObject({ stock: "7", item_id_cuenta: "500", origen: "webhook" })
    expect(await css("igz", "100")).toMatchObject({ stock: "10" })
    expect(await producto("100")).toMatchObject({ name: "Producto LED-1", stock: "10" })
    expect(await cola()).toEqual([])
    expect(avisarShopMock).toHaveBeenCalledTimes(1)
  })

  it("SOLO-SECUNDARIA: refresca sus datos y su stock; conserva la categoría ya resuelta", async () => {
    await sembrarProducto("mdp:900", "SOLO-1", { cuentaId: idMdp, alegraIdCuenta: "900", stock: 3, categoria: "cat-7" })
    await sembrarStock("mdp", "mdp:900", "900", 3)
    vivos["tok-mdp"]["900"] = item("900", "SOLO-1", 12, { name: "Solo 1 renombrado", categoryAlegraId: "cat-de-mdp" })
    await encolarDeCuenta(["900"])
    await drenar()
    expect(await producto("mdp:900")).toMatchObject({
      name: "Solo 1 renombrado",
      stock: "12",
      status: "active",
      cuenta_id: idMdp,
      alegra_id_cuenta: "900",
      category_alegra_id: "cat-7",
      leido_por: "webhook",
    })
    expect(await css("mdp", "mdp:900")).toMatchObject({ stock: "12" })
  })

  it("ADOPTADO (#671): la principal lo tiene inactivo; con stock 0 queda oculto y al reponer vuelve", async () => {
    await sembrarProducto("100", "LED-1", { status: "inactive", alegraStatus: "inactive" })
    await sembrarProducto("mdp:900", "LED-1", { cuentaId: idMdp, alegraIdCuenta: "900" })
    await sembrarStock("mdp", "mdp:900", "900", 4)
    vivos["tok-mdp"]["900"] = item("900", "LED-1", 0)
    await encolarDeCuenta(["900"])
    await drenar()
    expect((await producto("mdp:900")).status).toBe("inactive")
    vivos["tok-mdp"]["900"] = item("900", "LED-1", 3)
    await encolarDeCuenta(["900"])
    await drenar()
    expect((await producto("mdp:900")).status).toBe("active")
  })

  it("ÍTEM NUEVO solo en MDP: crea la fila solo-secundaria y su stock", async () => {
    vivos["tok-mdp"]["600"] = item("600", "NUEVO-1", 9)
    await encolarDeCuenta(["600"])
    const r = await drenar()
    expect(r.leidos).toBe(1)
    expect(await producto("mdp:600")).toMatchObject({ code: "NUEVO-1", status: "active", cuenta_id: idMdp, alegra_id_cuenta: "600", stock: "9" })
    expect(await css("mdp", "mdp:600")).toMatchObject({ item_id_cuenta: "600", stock: "9" })
  })

  it("ÍTEM NUEVO cuyo código ya tiene la principal ACTIVA: queda pareado (solo stock), sin fila propia", async () => {
    await sembrarProducto("100", "LED-1")
    vivos["tok-mdp"]["600"] = item("600", "led-1", 4)
    await encolarDeCuenta(["600"])
    await drenar()
    expect(await producto("mdp:600")).toBeUndefined()
    expect(await css("mdp", "100")).toMatchObject({ item_id_cuenta: "600", stock: "4" })
  })

  it("ÍTEM NUEVO con código repetido en MDP o sin código: se ignora (lo informa la sync)", async () => {
    await sembrarProducto("100", "LED-1")
    await sembrarStock("mdp", "100", "500", 5)
    vivos["tok-mdp"]["600"] = item("600", "LED-1", 4) // ya hay otro ítem de MDP (500) con ese código
    vivos["tok-mdp"]["601"] = item("601", null, 4)
    await encolarDeCuenta(["600", "601"])
    const r = await drenar()
    expect(r.errores).toBe(0)
    expect(await producto("mdp:600")).toBeUndefined()
    expect(await producto("mdp:601")).toBeUndefined()
    expect(await css("mdp", "100")).toMatchObject({ item_id_cuenta: "500", stock: "5" })
    expect(await cola()).toEqual([])
  })

  it("BORRADO en MDP (404): el pareado queda en 0; el solo-secundaria queda inactivo", async () => {
    await sembrarProducto("100", "LED-1")
    await sembrarStock("mdp", "100", "500", 5)
    await sembrarProducto("mdp:900", "SOLO-1", { cuentaId: idMdp, alegraIdCuenta: "900", stock: 3 })
    await sembrarStock("mdp", "mdp:900", "900", 3)
    await encolarDeCuenta(["500", "900"])
    const r = await drenar()
    expect(r).toMatchObject({ inactivos: 2, errores: 0 })
    expect(await css("mdp", "100")).toMatchObject({ stock: "0", item_id_cuenta: "500" })
    expect(await producto("mdp:900")).toMatchObject({ status: "inactive", stock: "0" })
    expect(await producto("100")).toMatchObject({ status: "active" })
  })

  it("la cola mezcla las dos cuentas: cada ítem se lee con las credenciales de la suya", async () => {
    await sembrarProducto("500", "PRINCIPAL-500", { stock: 1 })
    await sembrarProducto("100", "LED-1")
    await sembrarStock("mdp", "100", "500", 5)
    vivos["tok-igz"]["500"] = item("500", "PRINCIPAL-500", 22)
    vivos["tok-mdp"]["500"] = item("500", "LED-1", 8)
    await registrarAviso(A, "edit-item", { subject: "edit-item", message: { item: { id: 500 } } })
    await encolarDeCuenta(["500"])
    await drenar()
    expect(lecturas.sort((a, b) => a.token.localeCompare(b.token))).toEqual([
      { token: "tok-igz", id: "500" },
      { token: "tok-mdp", id: "500" },
    ])
    expect(await producto("500")).toMatchObject({ stock: "22" })
    expect(await css("mdp", "100")).toMatchObject({ stock: "8" })
  })

  it("cuenta desconocida o sin sucursales: se ignora y la fila sale de la cola", async () => {
    await encolarDeCuenta(["1"], "fantasma")
    const r = await drenar()
    expect(r).toMatchObject({ leidos: 0, errores: 0 })
    expect(await cola()).toEqual([])
    expect(lecturas).toEqual([])
  })

  it("cuenta sin credenciales: es un error de esa fila (queda para reintentar), no rompe el drenaje", async () => {
    await db().execute(sql`UPDATE alegra_cuentas SET alegra_token = '' WHERE slug = 'mdp'`)
    await encolarDeCuenta(["500"])
    const r = await drenar()
    expect(r.errores).toBe(1)
    expect(await cola()).toEqual(["mdp:500"])
    expect(lecturas).toEqual([])
  })
})
