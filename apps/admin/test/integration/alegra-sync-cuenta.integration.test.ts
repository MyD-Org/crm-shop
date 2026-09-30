import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraCategory, AlegraProduct } from "@/lib/alegra"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Sync multicuenta (change `sucursales-igz-mdp`, rebanada D, lote 2) contra Postgres real
// (crm_test) con el cliente de Alegra mockeado: cada cuenta se distingue por su token. Datos
// inventados: tenant-a, cuentas `principal` (igz) y `mdp`, ítems de fantasía.

const items: Record<string, AlegraProduct[]> = { "tok-igz": [], "tok-mdp": [] }
const categorias: Record<string, AlegraCategory[]> = { "tok-igz": [], "tok-mdp": [] }
const fallas = new Set<string>()

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listAllCategories: async (cfg: { alegraToken: string }) => categorias[cfg.alegraToken] ?? [],
  listAllItems: async (cfg: { alegraToken: string }) => {
    if (fallas.has(cfg.alegraToken)) throw new Error("alegra caída")
    return items[cfg.alegraToken] ?? []
  },
  listItemsLote: async (cfg: { alegraToken: string }, start: number) => {
    if (fallas.has(cfg.alegraToken)) throw new Error("alegra caída")
    const todos = items[cfg.alegraToken] ?? []
    const fin = start + tamLote >= todos.length
    return { items: todos.slice(start, start + tamLote), siguiente: start + tamLote, fin }
  },
}))
const tamLote = Number.POSITIVE_INFINITY

const { avisarShopMock } = vi.hoisted(() => ({ avisarShopMock: vi.fn() }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: avisarShopMock }))

const { syncTenant } = await import("@/lib/alegra-sync-tenant")
const { syncCatalog } = await import("@/lib/alegra-sync")
const { syncCuentaSecundaria, MSG_SIN_SUCURSAL } = await import("@/lib/alegra-sync-cuenta")
const { MSG_SYNC_EN_CURSO } = await import("@/lib/alegra-sync-guarda")

const A = "tenant-a"
const cfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as Parameters<typeof syncTenant>[0]

const LISTAS_IGZ = [
  { idPriceList: "1", name: "General" },
  { idPriceList: "5", name: "Mayorista" },
]

function it_(
  alegraId: string,
  code: string | null,
  stock: number | null,
  over: Partial<AlegraProduct> & { listas?: { idPriceList: string; name: string }[]; precio?: number } = {},
): AlegraProduct {
  const listas = over.listas ?? LISTAS_IGZ
  const precio = over.precio ?? 1000
  const prices = listas.map((l) => ({ idPriceList: l.idPriceList, name: l.name, price: precio }))
  const { listas: _l, precio: _p, ...resto } = over
  void _l
  void _p
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
    raw: { id: alegraId, price: prices },
    ...resto,
  }
}

// MDP usa OTROS ids de lista (9, 8): el mapeo es por nombre.
const mdp = (alegraId: string, code: string | null, stock: number | null, over: Parameters<typeof it_>[3] = {}) =>
  it_(alegraId, code, stock, { listas: [{ idPriceList: "9", name: "general" }], ...over })

const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (consulta: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(consulta))] as Fila[]

const producto = async (alegraId: string) =>
  (await filas(sql`SELECT * FROM catalog_products WHERE tenant_id = ${A} AND alegra_id = ${alegraId}`))[0]
const stockDe = async (sucursal: string, alegraId: string) =>
  (await filas(sql`SELECT * FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = ${sucursal} AND alegra_id = ${alegraId}`))[0]
const activasConCodigo = async (code: string) =>
  (await filas(sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${A} AND lower(btrim(code)) = ${code.toLowerCase()} AND status = 'active' AND coalesce(alegra_status,'active') <> 'inactive'`)).map(
    (f) => f.alegra_id,
  )
const ultimoLog = async (cuenta: "mdp" | null) =>
  (
    await filas(sql`
      SELECT l.* FROM catalog_sync_log l LEFT JOIN alegra_cuentas c ON c.id = l.cuenta_id
      WHERE l.tenant_id = ${A} AND ${cuenta ? sql`c.slug = ${cuenta}` : sql`l.cuenta_id IS NULL`}
      ORDER BY l.started_at DESC LIMIT 1`)
  )[0]

async function sembrarOverlay(alegraId: string, nombre: string) {
  await db().execute(sql`INSERT INTO catalog_overlay (tenant_id, alegra_id, visible, nombre) VALUES (${A}, ${alegraId}, true, ${nombre})`)
}

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_categories, catalog_sync_log, catalog_overlay, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`
    INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)
  `)
  await db().execute(sql`
    INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'mdp@cliente.example', 'tok-mdp')
  `)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE tenant_id = ${A} AND slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE tenant_id = ${A} AND slug = 'mdp'`)
  items["tok-igz"] = []
  items["tok-mdp"] = []
  categorias["tok-igz"] = []
  categorias["tok-mdp"] = []
  fallas.clear()
  avisarShopMock.mockReset()
  avisarShopMock.mockResolvedValue({ propagado: true })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterAll(async () => {
  vi.restoreAllMocks()
  await truncateAll()
})

async function cuentaMdp() {
  const [c] = await filas(sql`SELECT * FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'`)
  return {
    id: c.id as string,
    slug: "mdp",
    nombre: "Mar del Plata",
    principal: false,
    alegraEmail: "mdp@cliente.example",
    alegraToken: "tok-mdp",
    alegraMock: false,
  }
}

describe("par simple (código único a ambos lados)", () => {
  it("manda la principal y MDP aporta SOLO stock; el stock de IGZ también queda por sucursal", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5, { precio: 1000 })]
    items["tok-mdp"] = [mdp("900", "aaa", 3, { precio: 777, name: "Nombre de MDP" })]

    const r = await syncTenant(cfg, "manual")
    expect(r.ok).toBe(true)
    expect(r.cuentas).toHaveLength(1)
    expect(r.cuentas?.[0]).toMatchObject({ ok: true, cuenta: "mdp", pareados: 1, soloSecundaria: 0, duplicados: 0, sinCodigo: 0 })

    // Una sola fila en catalog_products, con los datos de IGZ.
    const todas = await filas(sql`SELECT alegra_id, name, cuenta_id, prices FROM catalog_products WHERE tenant_id = ${A}`)
    expect(todas).toHaveLength(1)
    expect(todas[0]).toMatchObject({ alegra_id: "1", name: "Producto AAA", cuenta_id: null })
    expect((todas[0].prices as { price: number }[])[0].price).toBe(1000)

    expect(await stockDe("igz", "1")).toMatchObject({ stock: "5", item_id_cuenta: "1", origen: "sync" })
    expect(await stockDe("mdp", "1")).toMatchObject({ stock: "3", item_id_cuenta: "900", origen: "sync" })
  })

  it("segunda corrida idempotente", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("900", "AAA", 3), mdp("901", "ZZZ", 2)]
    await syncTenant(cfg, "cron")
    const antes = await filas(sql`SELECT alegra_id, status, cuenta_id, stock FROM catalog_products WHERE tenant_id = ${A} ORDER BY alegra_id`)
    const cssAntes = await filas(sql`SELECT sucursal, alegra_id, stock, item_id_cuenta FROM catalog_stock_sucursal WHERE tenant_id = ${A} ORDER BY 1, 2`)
    const r = await syncTenant(cfg, "cron")
    expect(r.ok).toBe(true)
    expect(await filas(sql`SELECT alegra_id, status, cuenta_id, stock FROM catalog_products WHERE tenant_id = ${A} ORDER BY alegra_id`)).toEqual(antes)
    expect(await filas(sql`SELECT sucursal, alegra_id, stock, item_id_cuenta FROM catalog_stock_sucursal WHERE tenant_id = ${A} ORDER BY 1, 2`)).toEqual(cssAntes)
  })
})

describe("solo-IGZ y solo-MDP", () => {
  it("solo-IGZ: MDP queda con stock 0 implícito (sin fila) y no se inventa nada", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = []
    // 0 ítems en MDP sin historial = corrida parcial, pero no rompe nada.
    await syncTenant(cfg, "cron")
    expect(await stockDe("mdp", "1")).toBeUndefined()
    expect((await filas(sql`SELECT 1 FROM catalog_products WHERE tenant_id = ${A} AND cuenta_id IS NOT NULL`)).length).toBe(0)
  })

  it("solo-MDP: crea la fila sintética con sus datos (listas por nombre) y aparece en la vista del Shop", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("901", "ZZZ", 4, { name: "Solo de Mar del Plata", precio: 555 })]
    await syncTenant(cfg, "cron")

    const fila = await producto("mdp:901")
    expect(fila).toMatchObject({ code: "ZZZ", name: "Solo de Mar del Plata", status: "active", alegra_id_cuenta: "901", stock: "4", reemplazado_por_alegra_id: null })
    expect(fila.cuenta_id).toBeTruthy()
    // Lista "general" de MDP (id 9) → "General" de la principal (id 1).
    expect(fila.prices).toEqual([{ idPriceList: "1", name: "General", price: 555 }])
    expect(await stockDe("mdp", "mdp:901")).toMatchObject({ stock: "4", item_id_cuenta: "901" })

    const vista = await filas(sql`SELECT alegra_id, activo FROM catalog_products_shop WHERE tenant_id = ${A} AND alegra_id = 'mdp:901'`)
    expect(vista).toEqual([{ alegra_id: "mdp:901", activo: true }])
  })

  it("la sync de la PRINCIPAL no da de baja las filas solo-MDP (stale acotado a cuenta_id NULL)", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5), it_("2", "BBB", 5)]
    items["tok-mdp"] = [mdp("901", "ZZZ", 4)]
    await syncTenant(cfg, "cron")
    await new Promise((r) => setTimeout(r, 15))
    await syncCatalog(cfg, "cron", { aceptarBaja: true })
    expect((await producto("mdp:901")).status).toBe("active")
  })

  it("solo-MDP que desaparece: inactive + stock 0, acotado a su cuenta; pareados no vistos: stock 0 conservando el id", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("900", "AAA", 3), mdp("901", "ZZZ", 4), mdp("902", "YYY", 1)]
    await syncTenant(cfg, "cron")
    items["tok-mdp"] = [mdp("902", "YYY", 1)]
    const r = await syncTenant(cfg, "cron")
    expect(r.cuentas?.[0].ok).toBe(true)
    expect(r.cuentas?.[0].parcial).toBeUndefined()
    expect(await producto("mdp:901")).toMatchObject({ status: "inactive", stock: "0" })
    expect((await producto("mdp:902")).status).toBe("active")
    expect(await stockDe("mdp", "mdp:901")).toMatchObject({ stock: "0" })
    expect(await stockDe("mdp", "1")).toMatchObject({ stock: "0", item_id_cuenta: "900" })
    // Y el de IGZ no se tocó.
    expect(await stockDe("igz", "1")).toMatchObject({ stock: "5" })
  })
})

describe("IGZ inactivo (O8, #671)", () => {
  const inactivoEnIgz = () => [it_("2", "BBB", 9, { status: "inactive" })]

  it("con stock en MDP: la fila sintética queda activa con datos de MDP, el stock se mueve y el overlay se copia", async () => {
    // Estado previo: BBB era par (stock de MDP colgado de la clave de IGZ) y tenía overlay.
    items["tok-igz"] = [it_("2", "BBB", 9)]
    items["tok-mdp"] = [mdp("902", "BBB", 4, { name: "BBB de MDP", precio: 321 })]
    await syncTenant(cfg, "cron")
    expect(await stockDe("mdp", "2")).toMatchObject({ stock: "4", item_id_cuenta: "902" })
    await sembrarOverlay("2", "Nombre curado")

    items["tok-igz"] = inactivoEnIgz()
    const r = await syncTenant(cfg, "cron")
    expect(r.ok).toBe(true)
    expect(r.cuentas?.[0]).toMatchObject({ soloSecundaria: 1, pareados: 0 })

    const sint = await producto("mdp:902")
    expect(sint).toMatchObject({ status: "active", name: "BBB de MDP", alegra_id_cuenta: "902", stock: "4" })
    expect((sint.prices as { price: number }[])[0].price).toBe(321)
    // El stock de MDP se mueve de la clave de la principal a la sintética.
    expect(await stockDe("mdp", "2")).toMatchObject({ stock: "0", item_id_cuenta: null })
    expect(await stockDe("mdp", "mdp:902")).toMatchObject({ stock: "4", item_id_cuenta: "902" })
    // Overlay copiado a la sintética; el de la principal queda.
    expect((await filas(sql`SELECT nombre FROM catalog_overlay WHERE tenant_id = ${A} AND alegra_id = 'mdp:902'`))[0]).toEqual({ nombre: "Nombre curado" })
    expect((await filas(sql`SELECT nombre FROM catalog_overlay WHERE tenant_id = ${A} AND alegra_id = '2'`))[0]).toEqual({ nombre: "Nombre curado" })
    // Nunca dos filas activas para el mismo código.
    expect(await activasConCodigo("BBB")).toEqual(["mdp:902"])
  })

  it("con stock 0 en MDP: la sintética queda inactive; al reponer, se reactiva", async () => {
    items["tok-igz"] = inactivoEnIgz()
    items["tok-mdp"] = [mdp("902", "BBB", 0)]
    await syncTenant(cfg, "cron")
    expect((await producto("mdp:902")).status).toBe("inactive")
    expect(await activasConCodigo("BBB")).toEqual([])

    items["tok-mdp"] = [mdp("902", "BBB", 6)]
    await new Promise((r) => setTimeout(r, 15))
    await syncTenant(cfg, "cron")
    expect((await producto("mdp:902")).status).toBe("active")
    expect(await activasConCodigo("BBB")).toEqual(["mdp:902"])
  })

  it("IGZ lo reactiva: manda IGZ, el stock de MDP vuelve a la clave de IGZ y la sintética queda reemplazada", async () => {
    items["tok-igz"] = inactivoEnIgz()
    items["tok-mdp"] = [mdp("902", "BBB", 4)]
    await syncTenant(cfg, "cron")
    expect((await producto("mdp:902")).status).toBe("active")
    await sembrarOverlay("mdp:902", "Curado en la sintética")

    items["tok-igz"] = [it_("2", "BBB", 9)]
    const r = await syncTenant(cfg, "cron")
    expect(r.ok).toBe(true)

    expect(await producto("mdp:902")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "2" })
    expect(await stockDe("mdp", "2")).toMatchObject({ stock: "4", item_id_cuenta: "902" })
    expect(await stockDe("mdp", "mdp:902")).toBeUndefined()
    // La principal no tenía overlay: hereda el de la sintética.
    expect((await filas(sql`SELECT nombre FROM catalog_overlay WHERE tenant_id = ${A} AND alegra_id = '2'`))[0]).toEqual({ nombre: "Curado en la sintética" })
    expect(await activasConCodigo("BBB")).toEqual(["2"])

    // Y una corrida más no cambia nada.
    await syncTenant(cfg, "cron")
    expect(await activasConCodigo("BBB")).toEqual(["2"])
    expect(await stockDe("mdp", "2")).toMatchObject({ stock: "4" })
  })
})

describe("absorción cuando la principal da de alta un código que era solo-MDP", () => {
  it("mueve stock, copia overlay si la principal no tiene, marca la vieja reemplazada y no pierde order_items", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("903", "CCC", 7, { name: "CCC de MDP" })]
    await syncTenant(cfg, "cron")
    await sembrarOverlay("mdp:903", "Curado de MDP")

    // IGZ da de alta CCC: SOLO corre la sync de la principal (la de MDP no interviene).
    items["tok-igz"] = [it_("1", "AAA", 5), it_("3", "ccc", 2)]
    await syncCatalog(cfg, "cron")

    expect(await producto("mdp:903")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "3" })
    expect(await stockDe("mdp", "3")).toMatchObject({ stock: "7", item_id_cuenta: "903" })
    expect(await stockDe("mdp", "mdp:903")).toBeUndefined()
    expect((await filas(sql`SELECT nombre FROM catalog_overlay WHERE tenant_id = ${A} AND alegra_id = '3'`))[0]).toEqual({ nombre: "Curado de MDP" })
    expect(await activasConCodigo("CCC")).toEqual(["3"]) // una sola fila activa por código
    expect((await producto("3")).status).toBe("active")
    // La fila vieja sigue existiendo (los pedidos históricos apuntan a su id).
    expect(await producto("mdp:903")).toBeTruthy()
  })

  it("no pisa el overlay que la principal ya tenía", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("903", "CCC", 7)]
    await syncTenant(cfg, "cron")
    await sembrarOverlay("mdp:903", "De MDP")
    await sembrarOverlay("3", "Ya tenía")
    items["tok-igz"] = [it_("1", "AAA", 5), it_("3", "CCC", 2)]
    await syncCatalog(cfg, "cron")
    expect((await filas(sql`SELECT nombre FROM catalog_overlay WHERE tenant_id = ${A} AND alegra_id = '3'`))[0]).toEqual({ nombre: "Ya tenía" })
    expect((await producto("mdp:903")).reemplazado_por_alegra_id).toBe("3")
  })

  it("código duplicado en la principal: no absorbe", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("903", "CCC", 7)]
    await syncTenant(cfg, "cron")
    items["tok-igz"] = [it_("1", "AAA", 5), it_("3", "CCC", 2), it_("4", "CCC", 2)]
    await syncCatalog(cfg, "cron")
    expect(await producto("mdp:903")).toMatchObject({ status: "active", reemplazado_por_alegra_id: null })
  })
})

describe("códigos a revisar y listas sin equivalente", () => {
  it("duplicado en MDP y sin código: no entran al catálogo ni al stock y se informan en el resumen", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("910", "DUP", 1), mdp("911", "dup", 2), mdp("912", null, 3, { name: "Sin código" }), mdp("913", "OKK", 4)]
    const r = await syncTenant(cfg, "cron")
    expect(r.cuentas?.[0]).toMatchObject({ ok: true, soloSecundaria: 1, duplicados: 1, sinCodigo: 1 })
    expect(await producto("mdp:910")).toBeUndefined()
    expect(await producto("mdp:912")).toBeUndefined()
    expect(await producto("mdp:913")).toBeTruthy()

    const resumen = (await ultimoLog("mdp")).resumen as {
      duplicados: { total: number; items: { codigo: string; secundaria: { alegraId: string }[] }[] }
      sinCodigo: { total: number; items: { alegraId: string; nombre: string }[] }
    }
    expect(resumen.duplicados.total).toBe(1)
    expect(resumen.duplicados.items[0].secundaria.map((x) => x.alegraId)).toEqual(["910", "911"])
    expect(resumen.sinCodigo.items).toEqual([{ alegraId: "912", codigo: null, nombre: "Sin código" }])
  })

  it("lista de precio sin equivalente: se descarta, se informa y el producto sin precio no es vendible", async () => {
    items["tok-mdp"] = [
      mdp("920", "P1", 1, { listas: [{ idPriceList: "9", name: "general" }, { idPriceList: "8", name: "Lista de MDP" }] }),
      mdp("921", "P2", 1, { listas: [{ idPriceList: "8", name: "Lista de MDP" }] }),
    ]
    items["tok-igz"] = [it_("1", "AAA", 5)]
    const r = await syncTenant(cfg, "cron")
    expect(r.ok).toBe(true)
    expect((await producto("mdp:920")).prices).toEqual([{ idPriceList: "1", name: "General", price: 1000 }])
    expect((await producto("mdp:921")).prices).toEqual([])
    const resumen = (await ultimoLog("mdp")).resumen as { listasSinEquivalente: string[]; sinPrecio: number }
    expect(resumen.listasSinEquivalente).toEqual(["Lista de MDP"])
    expect(resumen.sinPrecio).toBe(1)
  })
})

describe("orquestación, concurrencia y guarda por cuenta", () => {
  it("una cuenta que falla no frena a la otra; el resumen trae cada cuenta y el log de MDP queda en error", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    fallas.add("tok-mdp")
    const r = await syncTenant(cfg, "cron")
    expect(r.ok).toBe(false)
    expect(r.itemsSynced).toBe(1)
    expect(r.cuentas).toEqual([expect.objectContaining({ cuenta: "mdp", ok: false })])
    expect(r.error).toBe("No se pudo sincronizar la cuenta mdp.")
    expect((await producto("1")).status).toBe("active")
    expect((await ultimoLog("mdp")).status).toBe("error")
    expect((await ultimoLog(null)).status).toBe("ok")
  })

  it("si falla la principal, la secundaria igual corre (y no duplica: no hay par contra una principal vacía)", async () => {
    fallas.add("tok-igz")
    items["tok-mdp"] = [mdp("930", "SOL", 2)]
    const r = await syncTenant(cfg, "cron")
    expect(r.ok).toBe(false)
    expect(r.cuentas?.[0]).toMatchObject({ ok: true, soloSecundaria: 1 })
  })

  it("sin cuentas secundarias activas: exactamente la sync de siempre (sin `cuentas`)", async () => {
    await db().execute(sql`UPDATE alegra_cuentas SET activa = false WHERE tenant_id = ${A} AND slug = 'mdp'`)
    items["tok-igz"] = [it_("1", "AAA", 5)]
    const r = await syncTenant(cfg, "cron")
    expect(r).toEqual({ ok: true, itemsSynced: 1, categoriesSynced: 0 })
    expect(r.cuentas).toBeUndefined()
  })

  it("guarda de concurrencia por cuenta: con una corrida en curso de MDP no arranca otra; la principal no se ve afectada", async () => {
    await db().execute(sql`
      INSERT INTO catalog_sync_log (tenant_id, trigger, status, cuenta_id, started_at)
      SELECT ${A}, 'cron', 'running', id, now() FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'
    `)
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("930", "SOL", 2)]
    const r = await syncTenant(cfg, "cron")
    expect(r.cuentas?.[0]).toMatchObject({ ok: false, error: MSG_SYNC_EN_CURSO })
    expect((await producto("mdp:930"))).toBeUndefined()
    expect((await producto("1")).status).toBe("active")
  })

  it("una corrida 'running' vieja (colgada) no bloquea", async () => {
    await db().execute(sql`
      INSERT INTO catalog_sync_log (tenant_id, trigger, status, cuenta_id, started_at)
      SELECT ${A}, 'cron', 'running', id, now() - interval '2 hours' FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'
    `)
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("930", "SOL", 2)]
    const r = await syncTenant(cfg, "cron")
    expect(r.cuentas?.[0].ok).toBe(true)
  })

  it("dos corridas simultáneas de la misma cuenta: una sola avanza", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = [mdp("930", "SOL", 2)]
    await syncCatalog(cfg, "cron")
    const c = await cuentaMdp()
    const [x, y] = await Promise.all([syncCuentaSecundaria(cfg, c, "cron"), syncCuentaSecundaria(cfg, c, "manual")])
    expect([x.ok, y.ok].sort()).toEqual([false, true])
    expect([x.error, y.error].filter(Boolean)).toEqual([MSG_SYNC_EN_CURSO])
  })

  it("cuenta sin sucursal asignada: error claro y no toca nada", async () => {
    await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = NULL WHERE tenant_id = ${A} AND slug = 'mdp'`)
    items["tok-mdp"] = [mdp("930", "SOL", 2)]
    const r = await syncCuentaSecundaria(cfg, await cuentaMdp(), "cron")
    expect(r).toMatchObject({ ok: false, error: MSG_SIN_SUCURSAL })
    expect(await producto("mdp:930")).toBeUndefined()
  })

  it("cuenta principal: no se sincroniza por acá", async () => {
    const [p] = await filas(sql`SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal`)
    const r = await syncCuentaSecundaria(cfg, { id: p.id as string, slug: "principal", nombre: "x", principal: true, alegraEmail: "", alegraToken: "", alegraMock: false }, "cron")
    expect(r.ok).toBe(false)
  })

  it("MDP tiene su propia base: una corrida chica de MDP no se compara con los ítems de IGZ", async () => {
    items["tok-igz"] = Array.from({ length: 200 }, (_, i) => it_(String(i + 1), `C${i}`, 1))
    items["tok-mdp"] = Array.from({ length: 5 }, (_, i) => mdp(String(i + 1000), `M${i}`, 1))
    await syncTenant(cfg, "cron")
    const r = await syncTenant(cfg, "cron")
    expect(r.cuentas?.[0].parcial).toBeUndefined()
    expect((await ultimoLog("mdp")).status).toBe("ok")
  })

  it("MDP lee mucho menos que su última corrida OK: parcial, sin dar de baja nada", async () => {
    items["tok-igz"] = [it_("1", "AAA", 5)]
    items["tok-mdp"] = Array.from({ length: 100 }, (_, i) => mdp(String(i + 1000), `M${i}`, 1))
    await syncTenant(cfg, "cron")
    items["tok-mdp"] = Array.from({ length: 50 }, (_, i) => mdp(String(i + 1000), `M${i}`, 1))
    const r = await syncTenant(cfg, "cron")
    expect(r.cuentas?.[0]).toMatchObject({ ok: true, parcial: true })
    expect((await filas(sql`SELECT 1 FROM catalog_products WHERE tenant_id = ${A} AND cuenta_id IS NOT NULL AND status = 'inactive'`)).length).toBe(0)
    expect((await ultimoLog("mdp")).status).toBe("parcial")
  })
})
