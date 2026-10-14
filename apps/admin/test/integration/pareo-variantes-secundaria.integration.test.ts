import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraCategory, AlegraItemCreateInput, AlegraProduct, AlegraTax } from "@/lib/alegra"
import { claveVariante } from "@/lib/variantes-puras"
import { crearSucursal } from "@/lib/sucursales-repo"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// Pareo IGZ<->MDP con variantes (change `variantes-de-producto`, S3) contra Postgres real
// (crm_test) con Alegra mockeada por token: el padre y sus variantes comparten código. Datos
// inventados (códigos de fantasía, dominios .example).

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
}))
vi.mock("@/lib/precios-online-costos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/precios-online-costos")>()),
  recalcularTrasSync: async () => {},
}))
const { avisarShopMock } = vi.hoisted(() => ({ avisarShopMock: vi.fn() }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: avisarShopMock }))

const { syncCuentaSecundaria } = await import("@/lib/alegra-sync-cuenta")
const { refrescarItemDeCuenta } = await import("@/lib/alegra-stock-cuenta")
const { absorberSoloSecundaria, claveVarianteSql } = await import("@/lib/catalogo-union-repo")
const { asegurarItemsEnCuenta } = await import("@/lib/alegra-items-cuenta")

const A = "tenant-a"
const cfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as TenantConfig
const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (q: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(q))] as Fila[]

const PRECIOS = [{ idPriceList: "9", name: "general", price: 800 }]

function it_(alegraId: string, code: string | null, stock: number | null, over: Partial<AlegraProduct> = {}): AlegraProduct {
  return {
    alegraId,
    code,
    name: `Producto ${code ?? alegraId}`,
    description: null,
    categoryAlegraId: null,
    prices: PRECIOS,
    stock,
    status: "active",
    images: [],
    brand: null,
    ivaPorcentaje: 21,
    raw: { id: alegraId, price: PRECIOS },
    ...over,
  }
}
const padre = (id: string, code: string | null, over: Partial<AlegraProduct> = {}) =>
  it_(id, code, null, { name: "Modelo", tipo: "padre", ...over })
const hija = (id: string, idPadre: string, code: string | null, opcion: string, stock: number | null, over: Partial<AlegraProduct> = {}) =>
  it_(id, code, stock, {
    name: `Modelo / ${opcion}`,
    tipo: "variante",
    padreAlegraId: idPadre,
    variante: [{ atributo: "Color", opcion }],
    varianteClave: claveVariante([{ atributo: "Color", opcion }]),
    ...over,
  })

/** Fila de la principal en el espejo (ya sincronizada). */
async function sembrarPrincipal(
  alegraId: string,
  code: string | null,
  o: { tipo?: string; padre?: string; opcion?: string; status?: string; stock?: number } = {},
) {
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, stock, tipo, padre_alegra_id, variante, variante_clave)
    VALUES (${A}, ${alegraId}, ${code}, ${`Producto ${alegraId}`}, ${o.status ?? "active"}, ${o.stock ?? 5}, ${o.tipo ?? "simple"}, ${o.padre ?? null},
            ${o.opcion ? JSON.stringify([{ atributo: "Color", opcion: o.opcion }]) : null}::jsonb,
            ${o.opcion ? claveVariante([{ atributo: "Color", opcion: o.opcion }]) : null})
  `)
}

const producto = async (alegraId: string) => (await filas(sql`SELECT * FROM catalog_products WHERE tenant_id = ${A} AND alegra_id = ${alegraId}`))[0]
const stockDe = async (sucursal: string, alegraId: string) =>
  (await filas(sql`SELECT * FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = ${sucursal} AND alegra_id = ${alegraId}`))[0]
const ultimoResumen = async () =>
  (await filas(sql`SELECT resumen FROM catalog_sync_log WHERE tenant_id = ${A} AND resumen IS NOT NULL ORDER BY started_at DESC LIMIT 1`))[0]?.resumen as {
    pareados: number
    soloSecundaria: number
    duplicados: { total: number }
    sinCodigo: { total: number }
    sinOpcion: { total: number }
  }

async function cuentaMdp() {
  const [c] = await filas(sql`SELECT * FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'`)
  return { id: c.id as string, slug: "mdp", nombre: "Mar del Plata", principal: false, alegraEmail: "mdp@cliente.example", alegraToken: "tok-mdp", alegraMock: false }
}
const sincronizar = async () => syncCuentaSecundaria(cfg, await cuentaMdp(), "manual")

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_categories, catalog_sync_log, catalog_overlay, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'mdp@cliente.example', 'tok-mdp')`)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE tenant_id = ${A} AND slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE tenant_id = ${A} AND slug = 'mdp'`)
  items["tok-igz"] = []
  items["tok-mdp"] = []
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

describe("sync de MDP: modelo que existe solo en MDP", () => {
  beforeEach(() => {
    items["tok-mdp"] = [
      padre("100", "XXA"),
      hija("101", "100", "XXA", "Rojo", 4),
      hija("102", "100", "XXA", "Verde", 0),
      hija("103", "100", "XXA", "Azul", 7),
    ]
  })

  it("queda el padre como ancla y TODAS las variantes, cada una con su stock (antes sobrevivía una sola)", async () => {
    const r = await sincronizar()
    expect(r).toMatchObject({ ok: true, soloSecundaria: 3, duplicados: 0 })

    for (const [id, stock] of [["101", 4], ["102", 0], ["103", 7]] as const) {
      const p = await producto(`mdp:${id}`)
      expect(p).toMatchObject({ tipo: "variante", padre_alegra_id: "mdp:100", grupo_id: "mdp:100", status: "active" })
      expect(Number((await stockDe("mdp", `mdp:${id}`)).stock)).toBe(stock)
    }
    const ancla = await producto("mdp:100")
    expect(ancla).toMatchObject({ tipo: "padre", grupo_id: null, es_representante: false })
    // El padre nunca lleva stock.
    expect(await stockDe("mdp", "mdp:100")).toBeUndefined()
    // Exactamente un representante entre las variantes.
    const reps = await filas(sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${A} AND tipo = 'variante' AND es_representante`)
    expect(reps).toHaveLength(1)
  })

  it("reaplicar la sync no duplica ni cambia nada", async () => {
    await sincronizar()
    const antes = await filas(sql`SELECT alegra_id, status, tipo, grupo_id FROM catalog_products WHERE tenant_id = ${A} ORDER BY alegra_id`)
    await sincronizar()
    const despues = await filas(sql`SELECT alegra_id, status, tipo, grupo_id FROM catalog_products WHERE tenant_id = ${A} ORDER BY alegra_id`)
    expect(despues).toEqual(antes)
    expect(despues).toHaveLength(4)
  })

  it("una corrida interrumpida a mitad no duplica ni da de baja lo activo; la siguiente se recupera", async () => {
    await sincronizar()
    fallas.add("tok-mdp")
    const rota = await sincronizar()
    expect(rota.ok).toBe(false)
    expect(await filas(sql`SELECT 1 FROM catalog_products WHERE tenant_id = ${A} AND status = 'inactive'`)).toHaveLength(0)
    fallas.clear()
    const ok = await sincronizar()
    expect(ok.ok).toBe(true)
    expect(await filas(sql`SELECT 1 FROM catalog_products WHERE tenant_id = ${A}`)).toHaveLength(4)
  })

  it("no marca falsos duplicados por compartir código (resumen para 'Códigos a revisar')", async () => {
    await sincronizar()
    const res = await ultimoResumen()
    expect(res.duplicados.total).toBe(0)
    expect(res.sinCodigo.total).toBe(0)
    expect(res.sinOpcion.total).toBe(0)
  })
})

describe("sync de MDP: modelo que existe en las dos cuentas", () => {
  beforeEach(async () => {
    await sembrarPrincipal("10", "XXB", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("11", "XXB", { tipo: "variante", padre: "10", opcion: "Rojo" })
    await sembrarPrincipal("12", "XXB", { tipo: "variante", padre: "10", opcion: "Verde" })
    items["tok-mdp"] = [
      padre("200", "XXB"),
      hija("201", "200", "XXB", "Rojo", 3),
      hija("202", "200", "XXB", "Verde", 6),
      hija("203", "200", "XXB", "Azul", 9),
    ]
  })

  it("se parea por opción (solo stock); la variante que IGZ no tiene entra bajo el padre de IGZ", async () => {
    const r = await sincronizar()
    expect(r).toMatchObject({ ok: true, pareados: 2, soloSecundaria: 1, duplicados: 0 })

    expect(Number((await stockDe("mdp", "11")).stock)).toBe(3)
    expect((await stockDe("mdp", "11")).item_id_cuenta).toBe("201")
    expect(Number((await stockDe("mdp", "12")).stock)).toBe(6)

    // El padre de MDP se parea con el de IGZ: no queda ancla propia y el suelto cuelga del padre de IGZ.
    expect(await producto("mdp:200")).toBeUndefined()
    expect(await producto("mdp:201")).toBeUndefined()
    expect(await producto("mdp:203")).toMatchObject({ tipo: "variante", padre_alegra_id: "10", grupo_id: "10", etiqueta: "Azul" })
  })

  it("las variantes pareadas no pisan nada de la principal", async () => {
    await sincronizar()
    expect(await producto("11")).toMatchObject({ tipo: "variante", padre_alegra_id: "10", status: "active" })
  })
})

describe("sync de MDP: casos a revisar", () => {
  it("variante sin opción: no entra y se informa; duplicado real (misma opción) tampoco", async () => {
    items["tok-mdp"] = [
      padre("100", "XXC"),
      hija("101", "100", "XXC", "Rojo", 1),
      hija("102", "100", "XXC", "Rojo", 2),
      hija("103", "100", "XXC", "Verde", 3, { variante: null, varianteClave: null }),
      hija("104", "100", "XXC", "Azul", 4),
    ]
    const r = await sincronizar()
    expect(r).toMatchObject({ ok: true, soloSecundaria: 1, duplicados: 1 })
    expect(await producto("mdp:104")).toBeDefined()
    expect(await producto("mdp:101")).toBeUndefined()
    expect(await producto("mdp:103")).toBeUndefined()
    const res = await ultimoResumen()
    expect(res.duplicados.total).toBe(1)
    expect(res.sinOpcion.total).toBe(1)
  })

  it("cruce: un simple de IGZ y una variante de MDP con el mismo código van a revisar, nunca par", async () => {
    await sembrarPrincipal("1", "XXD")
    items["tok-mdp"] = [padre("100", "ZZZ"), hija("101", "100", "XXD", "Rojo", 2)]
    const r = await sincronizar()
    expect(r).toMatchObject({ ok: true, pareados: 0, soloSecundaria: 0, duplicados: 1 })
    expect(await stockDe("mdp", "1")).toBeUndefined()
  })

  it("un modelo con 6 variantes y un código compartido no marca nada", async () => {
    items["tok-mdp"] = [
      padre("100", "XXE"),
      ...["a", "b", "c", "d", "e", "f"].map((o, i) => hija(String(101 + i), "100", "XXE", o, 1)),
    ]
    await sincronizar()
    const res = await ultimoResumen()
    expect(res.duplicados.total).toBe(0)
    expect(res.soloSecundaria).toBe(6)
  })
})

describe("absorción con variantes", () => {
  it("cuando IGZ carga el modelo, cada variante y el padre se absorben por (código, opción) y el grupo se unifica", async () => {
    items["tok-mdp"] = [padre("100", "XXF"), hija("101", "100", "XXF", "Rojo", 4), hija("102", "100", "XXF", "Verde", 5)]
    await sincronizar()
    expect(await producto("mdp:100")).toMatchObject({ tipo: "padre", status: "active" })

    // IGZ da de alta el padre y SOLO la variante roja.
    await sembrarPrincipal("20", "XXF", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("21", "XXF", { tipo: "variante", padre: "20", opcion: "Rojo" })
    const r = await absorberSoloSecundaria(A)
    expect(r.absorbidos).toBe(2) // el padre y el rojo

    expect(await producto("mdp:101")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "21" })
    expect(await producto("mdp:100")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "20" })
    expect(Number((await stockDe("mdp", "21")).stock)).toBe(4)
    // La verde no tiene par en IGZ: sigue activa y ahora cuelga del padre de IGZ.
    expect(await producto("mdp:102")).toMatchObject({ status: "active", padre_alegra_id: "20", grupo_id: "20" })
  })

  it("un modelo solo-MDP con 3 variantes del mismo código no se absorbe por un simple de IGZ con ese código", async () => {
    items["tok-mdp"] = [padre("100", "XXG"), hija("101", "100", "XXG", "Rojo", 4), hija("102", "100", "XXG", "Verde", 5)]
    await sincronizar()
    await sembrarPrincipal("30", "XXG")
    const r = await absorberSoloSecundaria(A)
    expect(r.absorbidos).toBe(0)
  })
})

describe("webhook de MDP con variantes", () => {
  const baseCfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as TenantConfig
  const vivos: Record<string, AlegraProduct | null> = {}
  const deps = { getItem: async (_c: TenantConfig, id: string) => vivos[id] ?? null }

  beforeEach(() => {
    for (const k of Object.keys(vivos)) delete vivos[k]
  })

  it("un hijo desconocido cuyo hermano comparte código entra como mdp:<id> (no se ignora por 'duplicado')", async () => {
    items["tok-mdp"] = [padre("100", "XXH"), hija("101", "100", "XXH", "Rojo", 4)]
    await sincronizar()
    vivos["102"] = hija("102", "100", "XXH", "Verde", 8)
    const r = await refrescarItemDeCuenta(baseCfg, "mdp:102", new Date(), {}, deps)
    expect(r).toBe("nuevo")
    expect(await producto("mdp:102")).toMatchObject({ tipo: "variante", padre_alegra_id: "mdp:100", grupo_id: "mdp:100", etiqueta: "Verde" })
    expect(Number((await stockDe("mdp", "mdp:102")).stock)).toBe(8)
  })

  it("un hijo desconocido con la MISMA opción que un hermano ya conocido es duplicado y se ignora", async () => {
    items["tok-mdp"] = [padre("100", "XXI"), hija("101", "100", "XXI", "Rojo", 4)]
    await sincronizar()
    vivos["102"] = hija("102", "100", "XXI", "Rojo", 8)
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:102", new Date(), {}, deps)).toBe("ignorado")
    expect(await producto("mdp:102")).toBeUndefined()
  })

  it("un hijo cuya contraparte existe en IGZ es un par: solo stock", async () => {
    await sembrarPrincipal("10", "XXJ", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("11", "XXJ", { tipo: "variante", padre: "10", opcion: "Rojo" })
    await sembrarPrincipal("12", "XXJ", { tipo: "variante", padre: "10", opcion: "Verde" })
    vivos["201"] = hija("201", "200", "XXJ", "Verde", 3)
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:201", new Date(), {}, deps)).toBe("nuevo")
    expect(Number((await stockDe("mdp", "12")).stock)).toBe(3)
    expect(await producto("mdp:201")).toBeUndefined()
  })

  it("un hijo nuevo cuyo padre de MDP está pareado con el de IGZ cuelga del padre de IGZ", async () => {
    await sembrarPrincipal("10", "XXK", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("11", "XXK", { tipo: "variante", padre: "10", opcion: "Rojo" })
    vivos["200"] = padre("200", "XXK")
    vivos["203"] = hija("203", "200", "XXK", "Azul", 2)
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:203", new Date(), {}, deps)).toBe("nuevo")
    expect(await producto("mdp:203")).toMatchObject({ padre_alegra_id: "10", grupo_id: "10" })
    expect(await producto("mdp:200")).toBeUndefined()
  })

  it("el aviso de un padre sin par lo guarda como ancla, sin stock vendible", async () => {
    vivos["100"] = padre("100", "XXL", { stock: 50 })
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:100", new Date(), {}, deps)).toBe("nuevo")
    expect(await producto("mdp:100")).toMatchObject({ tipo: "padre", es_representante: false })
    expect(await stockDe("mdp", "mdp:100")).toBeUndefined()
  })

  it("el aviso de un padre pareado con el de IGZ no escribe nada", async () => {
    await sembrarPrincipal("10", "XXM", { tipo: "padre", stock: 0 })
    vivos["100"] = padre("100", "XXM")
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:100", new Date(), {}, deps)).toBe("pareado")
    expect(await producto("mdp:100")).toBeUndefined()
  })

  it("un hijo propio ya unificado con el padre de IGZ conserva ese padre al refrescarse", async () => {
    await sembrarPrincipal("10", "XXN", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("11", "XXN", { tipo: "variante", padre: "10", opcion: "Rojo" })
    items["tok-mdp"] = [padre("200", "XXN"), hija("203", "200", "XXN", "Azul", 2)]
    await sincronizar()
    expect(await producto("mdp:203")).toMatchObject({ padre_alegra_id: "10" })
    vivos["203"] = hija("203", "200", "XXN", "Azul", 9)
    await refrescarItemDeCuenta(baseCfg, "mdp:203", new Date(Date.now() + 1000), {}, deps)
    expect(await producto("mdp:203")).toMatchObject({ padre_alegra_id: "10", grupo_id: "10" })
    expect(Number((await stockDe("mdp", "mdp:203")).stock)).toBe(9)
  })
})

describe("webhook de MDP sobre filas ya absorbidas por IGZ", () => {
  const baseCfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as TenantConfig
  const vivos: Record<string, AlegraProduct | null> = {}
  const deps = { getItem: async (_c: TenantConfig, id: string) => vivos[id] ?? null }

  // El modelo se cargó primero en MDP y después en IGZ; la sync lo absorbió. Un aviso posterior de
  // MDP (p. ej. un cambio de nombre) no debe reactivar la copia como duplicado.
  async function absorbido(code: string) {
    items["tok-mdp"] = [padre("100", code), hija("101", "100", code, "Rojo", 4), it_("110", `${code}-S`, 6)]
    await sincronizar()
    await sembrarPrincipal("20", code, { tipo: "padre", stock: 0 })
    await sembrarPrincipal("21", code, { tipo: "variante", padre: "20", opcion: "Rojo" })
    await sembrarPrincipal("30", `${code}-S`)
    expect((await absorberSoloSecundaria(A)).absorbidos).toBe(3)
  }

  it("el aviso del padre absorbido no lo reactiva", async () => {
    await absorbido("XXP")
    vivos["100"] = padre("100", "XXP", { name: "Modelo renombrado" })
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:100", new Date(Date.now() + 1000), {}, deps)).toBe("pareado")
    expect(await producto("mdp:100")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "20" })
  })

  it("el aviso de una variante absorbida no la reactiva y su stock va a la de IGZ", async () => {
    await absorbido("XXQ")
    vivos["101"] = hija("101", "100", "XXQ", "Rojo", 7, { name: "Modelo renombrado / Rojo" })
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:101", new Date(Date.now() + 1000), {}, deps)).toBe("pareado")
    expect(await producto("mdp:101")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "21" })
    expect(Number((await stockDe("mdp", "21")).stock)).toBe(7)
  })

  it("el aviso de un simple absorbido no lo reactiva", async () => {
    await absorbido("XXR")
    vivos["110"] = it_("110", "XXR-S", 2)
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:110", new Date(Date.now() + 1000), {}, deps)).toBe("pareado")
    expect(await producto("mdp:110")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "30" })
    expect(Number((await stockDe("mdp", "30")).stock)).toBe(2)
  })

  it("una fila propia SIN par en IGZ se sigue refrescando como solo-secundaria", async () => {
    items["tok-mdp"] = [it_("120", "SOLO-MDP", 3)]
    await sincronizar()
    vivos["120"] = it_("120", "SOLO-MDP", 5, { name: "Solo MDP renombrado" })
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:120", new Date(Date.now() + 1000), {}, deps)).toBe("solo_secundaria")
    expect(await producto("mdp:120")).toMatchObject({ status: "active", name: "Solo MDP renombrado", reemplazado_por_alegra_id: null })
  })
})

describe("facturar una variante por la otra cuenta (asegurarItemsEnCuenta)", () => {
  const TAXES: AlegraTax[] = [{ alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" }] as AlegraTax[]
  let existentesMdp: AlegraProduct[] = []
  const creaciones: AlegraItemCreateInput[] = []
  const deps = {
    buscarPorCodigo: async (_c: TenantConfig, codigo: string) => existentesMdp.filter((i) => (i.code ?? "").toLowerCase() === codigo.toLowerCase()),
    crearItem: async (_c: TenantConfig, input: AlegraItemCreateInput) => {
      creaciones.push(input)
      return { alegraId: "9999", code: input.code, name: input.name } as AlegraProduct
    },
    listTaxes: async () => TAXES,
  }
  const cfgMdp = { ...cfg, alegraToken: "tok-mdp" } as TenantConfig
  let MDP: { id: string; slug: string; nombre: string; principal: boolean }

  beforeEach(async () => {
    creaciones.length = 0
    const c = await cuentaMdp()
    MDP = { id: c.id, slug: "mdp", nombre: "Mar del Plata", principal: false }
    await sembrarPrincipal("10", "XXP", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("11", "XXP", { tipo: "variante", padre: "10", opcion: "Blanco cálido" })
    await sembrarPrincipal("12", "XXP", { tipo: "variante", padre: "10", opcion: "Blanco frío" })
    existentesMdp = [
      padre("200", "XXP"),
      hija("201", "200", "XXP", "blanco calido", 1),
      hija("202", "200", "XXP", "Blanco Frío", 1),
    ]
  })
  const linea = (id: string) => ({ alegraItemId: id, nombre: `Panel / ${id}`, precioUnitario: 500, ivaPorcentaje: 21 })

  it("resuelve el ítem de la variante correcta aunque todas compartan código (sin 'código repetido')", async () => {
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("12"), linea("11")], deps)
    expect(r).toMatchObject({ ok: true, creados: [] })
    if (r.ok) {
      expect(r.ids.get("12")).toBe("202")
      expect(r.ids.get("11")).toBe("201")
    }
    expect(creaciones).toHaveLength(0)
    // Queda el pareo para la próxima.
    expect((await stockDe("mdp", "12")).item_id_cuenta).toBe("202")
  })

  it("si la variante no está en la otra cuenta: error en usted y NO se crea un simple", async () => {
    existentesMdp = [padre("200", "XXP"), hija("201", "200", "XXP", "Blanco cálido", 1)]
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("12")], deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Cargue la variante en esa cuenta/)
    expect(creaciones).toHaveLength(0)
  })

  it("dos variantes con la misma opción en la cuenta destino: duplicado real", async () => {
    existentesMdp = [hija("201", "200", "XXP", "Blanco Frío", 1), hija("202", "200", "XXP", "blanco frio", 1)]
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("12")], deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/repetido/)
  })

  it("un simple cuyo código en la otra cuenta es de un modelo con variantes no se crea ni se elige", async () => {
    await sembrarPrincipal("50", "XXP")
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("50")], deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/producto con variantes/)
    expect(creaciones).toHaveLength(0)
  })

  it("un simple sigue resolviéndose o creándose como siempre", async () => {
    await sembrarPrincipal("51", "SOLO1")
    existentesMdp = []
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("51")], deps)
    expect(r).toMatchObject({ ok: true, creados: ["51"] })
    expect(creaciones).toHaveLength(1)
  })
})

describe("claveVarianteSql = claveVariante (paridad TS<->SQL)", () => {
  const casos: { nombre: string; v: { atributo: string; opcion: string }[] }[] = [
    { nombre: "simple", v: [{ atributo: "Color", opcion: "Verde" }] },
    { nombre: "tildes y mayúsculas", v: [{ atributo: "Tono", opcion: "Blanco CÁLIDO" }] },
    { nombre: "espacios", v: [{ atributo: "Color", opcion: "  Blanco   frío  " }] },
    { nombre: "ñ", v: [{ atributo: "Color", opcion: "Ñandú" }] },
    { nombre: "multi-opción se ordena", v: [{ atributo: "Potencia", opcion: "18W" }, { atributo: "Color", opcion: "Azul" }] },
    { nombre: "opción vacía se descarta", v: [{ atributo: "Color", opcion: "   " }, { atributo: "Potencia", opcion: "9W" }] },
    { nombre: "orden por bytes", v: [{ atributo: "A", opcion: "b-1" }, { atributo: "B", opcion: "B_2" }, { atributo: "C", opcion: "a 3" }] },
  ]
  for (const c of casos) {
    it(c.nombre, async () => {
      const [fila] = await filas(sql`SELECT ${sql.raw(claveVarianteSql("t.v"))} AS k FROM (SELECT ${JSON.stringify(c.v)}::jsonb AS v) t`)
      expect(fila.k ?? null).toBe(claveVariante(c.v))
    })
  }
  it("null / sin opciones = null", async () => {
    const [fila] = await filas(sql`SELECT ${sql.raw(claveVarianteSql("t.v"))} AS k FROM (SELECT NULL::jsonb AS v) t`)
    expect(fila.k).toBeNull()
  })
})

describe("fila solo-secundaria reactivada por error sobre un modelo que IGZ ya tiene (EMBPISO-LPR)", () => {
  const baseCfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as TenantConfig
  const vivos: Record<string, AlegraProduct | null> = {}
  const deps = { getItem: async (_c: TenantConfig, id: string) => vivos[id] ?? null }

  // Estado de producción: el modelo se cargó antes en MDP (una sola fila sobrevivía por modelo),
  // IGZ lo cargó después, la sync parió el par (stock de MDP en la fila de IGZ) y la fila vieja
  // quedó ACTIVA y sin marca de absorción.
  async function conSueltaActiva() {
    await sembrarPrincipal("20", "XXS", { tipo: "padre", stock: 0 })
    await sembrarPrincipal("21", "XXS", { tipo: "variante", padre: "20", opcion: "Blanco cálido" })
    await sembrarPrincipal("22", "XXS", { tipo: "variante", padre: "20", opcion: "Verde" })
    items["tok-mdp"] = [
      padre("300", "XXS"),
      hija("301", "300", "XXS", "Blanco cálido", 0),
      hija("302", "300", "XXS", "Verde", 0),
    ]
    await sincronizar()
    await db().execute(sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, stock, tipo, padre_alegra_id, variante, variante_clave, cuenta_id, alegra_id_cuenta)
      VALUES (${A}, 'mdp:301', 'XXS', 'Modelo / Blanco cálido', 'active', 0, 'variante', 'mdp:300',
              ${JSON.stringify([{ atributo: "Color", opcion: "Blanco cálido" }])}::jsonb, 'blanco calido',
              (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'), '301')
    `)
  }

  it("el aviso de la variante suelta no queda en error ni la deja activa: se absorbe y su stock va a IGZ", async () => {
    await conSueltaActiva()
    expect((await stockDe("mdp", "21")).item_id_cuenta).toBe("301")
    vivos["301"] = hija("301", "300", "XXS", "Blanco cálido", 5)
    expect(await refrescarItemDeCuenta(baseCfg, "mdp:301", new Date(Date.now() + 1000), {}, deps)).toBe("pareado")
    expect(await producto("mdp:301")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "21" })
    expect(Number((await stockDe("mdp", "21")).stock)).toBe(5)
  })

  it("la sync de MDP absorbe la suelta que quedó activa", async () => {
    await conSueltaActiva()
    await sincronizar()
    expect(await producto("mdp:301")).toMatchObject({ status: "inactive", reemplazado_por_alegra_id: "21" })
  })
})
