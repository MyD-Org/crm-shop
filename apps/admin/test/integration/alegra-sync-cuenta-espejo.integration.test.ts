import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraCategory, AlegraProduct } from "@/lib/alegra"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Espejo de precios y costo de la cuenta secundaria (0104, change `listas-alegra-desde-costo`, R1)
// contra Postgres real (crm_test) con Alegra mockeado. Datos inventados: tenant-a, cuentas
// `principal` y `mdp`, ítems de fantasía.

const items: Record<string, AlegraProduct[]> = { "tok-igz": [], "tok-mdp": [] }
const categorias: Record<string, AlegraCategory[]> = { "tok-igz": [], "tok-mdp": [] }

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async (cfg: { alegraToken: string }) => categorias[cfg.alegraToken] ?? [],
  listAllItems: async (cfg: { alegraToken: string }) => items[cfg.alegraToken] ?? [],
}))
const { avisarShopMock } = vi.hoisted(() => ({ avisarShopMock: vi.fn() }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: avisarShopMock }))

const { syncCuentaSecundaria } = await import("@/lib/alegra-sync-cuenta")
const { refrescarItemDeCuenta } = await import("@/lib/alegra-stock-cuenta")

const A = "tenant-a"
const B = "tenant-b"
const base = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as Parameters<typeof syncCuentaSecundaria>[0]

const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (q: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(q))] as Fila[]

function it_(alegraId: string, code: string | null, stock: number | null, precios: [string, string, number][], costo: number | null = null, over: Partial<AlegraProduct> = {}): AlegraProduct {
  const prices = precios.map(([idPriceList, name, price]) => ({ idPriceList, name, price }))
  return {
    alegraId,
    code,
    name: `Producto ${code ?? alegraId}`,
    description: null,
    categoryAlegraId: null,
    prices,
    stock,
    status: "active",
    images: [],
    brand: null,
    ivaPorcentaje: 21,
    costo,
    raw: { id: alegraId, price: prices, inventory: { unitCost: costo ?? 0 } },
    ...over,
  }
}
const principal = (alegraId: string, code: string, stock = 5) => it_(alegraId, code, stock, [["1", "General", 1000]], 500)
const mdp = (alegraId: string, code: string | null, stock: number | null, precios: [string, string, number][] = [["9", "general", 777.5]], costo: number | null = 400) =>
  it_(alegraId, code, stock, precios, costo)

const espejo = async (cuenta = "mdp", tenant = A) =>
  filas(sql`
    SELECT p.* FROM catalog_precios_cuenta p JOIN alegra_cuentas c ON c.id = p.cuenta_id AND c.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${tenant} AND c.slug = ${cuenta} ORDER BY p.item_id`)
const fila = async (itemId: string) => (await espejo()).find((f) => f.item_id === itemId)

async function cuentaMdp() {
  const [c] = await filas(sql`SELECT * FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'`)
  return { id: c.id as string, slug: "mdp", nombre: "Mar del Plata", principal: false, alegraEmail: "mdp@cliente.example", alegraToken: "tok-mdp", alegraMock: false }
}
const sync = async () => syncCuentaSecundaria(base, await cuentaMdp(), "manual")

async function sembrarPrincipal(...its: AlegraProduct[]) {
  for (const p of its) {
    await db().execute(sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, stock)
      VALUES (${A}, ${p.alegraId}, ${p.code}, ${p.name}, 'active', ${p.stock ?? 0})`)
  }
}

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_categories, catalog_sync_log, catalog_overlay, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await seedTenant(B)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'mdp@cliente.example', 'tok-mdp')`)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE tenant_id = ${A} AND slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE tenant_id = ${A} AND slug = 'mdp'`)
  items["tok-igz"] = []
  items["tok-mdp"] = []
  categorias["tok-igz"] = []
  categorias["tok-mdp"] = []
  avisarShopMock.mockReset()
  avisarShopMock.mockResolvedValue({ propagado: true })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterAll(async () => {
  vi.restoreAllMocks()
  await truncateAll()
})

describe("espejo de precios tras syncCuentaSecundaria", () => {
  it("guarda precios por lista y costo de los ítems pareados y de los solo-MDP, con leido_at", async () => {
    await sembrarPrincipal(principal("1", "AAA"))
    items["tok-mdp"] = [mdp("900", "AAA", 3), mdp("901", "ZZZ", 2, [["9", "general", 555], ["8", "l1", 600.01]], 321.5)]
    const r = await sync()
    expect(r.ok).toBe(true)

    const pareado = await fila("900")
    expect(pareado).toMatchObject({ tipo: "simple", estado: "active" })
    expect(pareado?.precios).toEqual([{ idPriceList: "9", name: "general", price: 777.5 }])
    expect(Number(pareado?.costo)).toBe(400)
    expect(pareado?.leido_at).toBeTruthy()

    const solo = await fila("901")
    expect(solo?.precios).toEqual([
      { idPriceList: "9", name: "general", price: 555 },
      { idPriceList: "8", name: "l1", price: 600.01 },
    ])
    expect(Number(solo?.costo)).toBe(321.5)
  })

  it("costo 0 o ausente queda NULL; ítems duplicados o sin código también entran (son TODOS los leídos)", async () => {
    items["tok-mdp"] = [mdp("900", "AAA", 1, [["9", "general", 10]], null), mdp("901", null, 1), mdp("902", "DUP", 1), mdp("903", "dup", 1)]
    await sync()
    expect((await espejo()).map((f) => f.item_id)).toEqual(["900", "901", "902", "903"])
    expect((await fila("900"))?.costo).toBeNull()
  })

  it("segunda corrida: actualiza precios y borra los ítems que ya no se ven", async () => {
    items["tok-mdp"] = [mdp("900", "AAA", 1), mdp("901", "BBB", 1)]
    await sync()
    items["tok-mdp"] = [mdp("900", "AAA", 1, [["9", "general", 900]], 450), mdp("902", "CCC", 1), mdp("903", "DDD", 1), mdp("904", "EEE", 1), mdp("905", "FFF", 1), mdp("906", "GGG", 1)]
    const r = await sync()
    expect(r.ok).toBe(true)
    expect(r.parcial).toBeUndefined()
    expect((await espejo()).map((f) => f.item_id)).toEqual(["900", "902", "903", "904", "905", "906"])
    expect((await fila("900"))?.precios).toEqual([{ idPriceList: "9", name: "general", price: 900 }])
    expect(Number((await fila("900"))?.costo)).toBe(450)
  })

  it("guarda de frescura: una lectura más nueva (webhook) no la pisa la sync con datos viejos", async () => {
    items["tok-mdp"] = [mdp("900", "AAA", 1)]
    await sync()
    await db().execute(sql`UPDATE catalog_precios_cuenta SET precios = '[{"idPriceList":"9","name":"general","price":1}]'::jsonb, leido_at = now() + interval '1 hour' WHERE item_id = '900'`)
    await sync()
    expect((await fila("900"))?.precios).toEqual([{ idPriceList: "9", name: "general", price: 1 }])
  })

  it("lectura parcial (0 ítems): no se borra nada del espejo", async () => {
    items["tok-mdp"] = [mdp("900", "AAA", 1), mdp("901", "BBB", 1)]
    await sync()
    items["tok-mdp"] = []
    const r = await sync()
    expect(r.parcial).toBe(true)
    expect((await espejo()).map((f) => f.item_id)).toEqual(["900", "901"])
  })

  it("aislamiento por tenant y cuenta: no toca el espejo de otra cuenta ni de otro tenant", async () => {
    await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${B}, 'mdp', 'Otra', 'x@cliente.example', 'tok-x')`)
    const [{ id: cuentaB }] = await filas(sql`SELECT id FROM alegra_cuentas WHERE tenant_id = ${B} AND slug = 'mdp'`) as { id: string }[]
    await db().execute(sql`INSERT INTO catalog_precios_cuenta (tenant_id, cuenta_id, item_id, leido_at) VALUES (${B}, ${cuentaB}::uuid, '900', '2000-01-01')`)
    items["tok-mdp"] = [mdp("900", "AAA", 1)]
    await sync()
    await sync()
    expect(await espejo("mdp", B)).toHaveLength(1)
    expect(new Date(String((await espejo("mdp", B))[0].leido_at)).getFullYear()).toBe(2000)
  })

  it("si el espejo falla, la sync del catálogo y del stock sigue (best-effort)", async () => {
    await db().execute(sql`ALTER TABLE catalog_precios_cuenta RENAME TO catalog_precios_cuenta_x`)
    try {
      await sembrarPrincipal(principal("1", "AAA"))
      items["tok-mdp"] = [mdp("900", "AAA", 3)]
      const r = await sync()
      expect(r.ok).toBe(true)
      const stock = await filas(sql`SELECT stock FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = 'mdp' AND alegra_id = '1'`)
      expect(stock[0]).toMatchObject({ stock: "3" })
    } finally {
      await db().execute(sql`ALTER TABLE catalog_precios_cuenta_x RENAME TO catalog_precios_cuenta`)
    }
  })
})

describe("espejo de precios tras el refresco por webhook", () => {
  const getItem = (vivo: AlegraProduct | null) => async () => vivo
  const refrescar = (id: string, vivo: AlegraProduct | null, leidoAt = new Date()) =>
    refrescarItemDeCuenta(base, `mdp:${id}`, leidoAt, {}, { getItem: getItem(vivo) })

  it("una edición de precio hecha a mano en Alegra actualiza el espejo", async () => {
    await sembrarPrincipal(principal("1", "AAA"))
    items["tok-mdp"] = [mdp("900", "AAA", 3)]
    await sync()
    expect(((await fila("900"))?.precios as { price: number }[])[0].price).toBe(777.5)

    const editado = mdp("900", "AAA", 3, [["9", "general", 810.25]], 400)
    await refrescar("900", editado)
    expect(((await fila("900"))?.precios as { price: number }[])[0].price).toBe(810.25)
  })

  it("un ítem nuevo (aún sin pareo) también queda en el espejo", async () => {
    await refrescar("950", mdp("950", "NUEVO", 1, [["9", "general", 42]], 20))
    expect(await fila("950")).toMatchObject({ item_id: "950" })
  })

  it("un aviso viejo no pisa una lectura más nueva", async () => {
    items["tok-mdp"] = [mdp("900", "AAA", 3)]
    await sync()
    await refrescar("900", mdp("900", "AAA", 3, [["9", "general", 1]]), new Date("2000-01-01T00:00:00Z"))
    expect(((await fila("900"))?.precios as { price: number }[])[0].price).toBe(777.5)
  })

  it("404 en Alegra borra la fila", async () => {
    items["tok-mdp"] = [mdp("900", "AAA", 3)]
    await sync()
    await refrescar("900", null)
    expect(await fila("900")).toBeUndefined()
  })
})
