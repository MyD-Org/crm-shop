import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraItemCreateInput, AlegraProduct, AlegraTax } from "@/lib/alegra"
import {
  asegurarItemsEnCuenta,
  itemsSinIdEnCuenta,
  type CuentaDestino,
  type DepsItemsCuenta,
  type LineaParaCuenta,
} from "@/lib/alegra-items-cuenta"
import { crearSucursal } from "@/lib/sucursales-repo"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// `asegurarItemsEnCuenta` (change `sucursales-igz-mdp`, rebanada D, lote 3) contra Postgres real
// (crm_test) con Alegra inyectada: "IGZ" (principal) y "MDP" (secundaria) son cuentas de fantasía y
// el cliente de Alegra es un fake en memoria por cuenta. Datos inventados.

const A = "tenant-a"
const cfg = { id: A, alegraEmail: "x@cliente.example", alegraToken: "t", alegraMock: false } as TenantConfig

const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (consulta: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(consulta))] as Fila[]

let IGZ: CuentaDestino
let MDP: CuentaDestino

const TAXES: AlegraTax[] = [
  { alegraId: "1", name: "IVA 21%", percentage: 21, status: "active" },
  { alegraId: "4", name: "Exento", percentage: 0, status: "active" },
] as AlegraTax[]

/** Alegra falsa: una lista de ítems por cuenta (credencial = token). */
function alegraFalsa(inicial: Record<string, AlegraProduct[]> = {}) {
  const items: Record<string, AlegraProduct[]> = { igz: [], mdp: [], ...inicial }
  const creaciones: { cuenta: string; input: AlegraItemCreateInput }[] = []
  let siguiente = 9000
  const cuentaDe = (c: TenantConfig) => (c.alegraToken === "tok-mdp" ? "mdp" : "igz")
  const deps: DepsItemsCuenta = {
    buscarPorCodigo: async (c, codigo) => items[cuentaDe(c)].filter((i) => (i.code ?? "").toLowerCase() === codigo.toLowerCase()),
    crearItem: async (c, input) => {
      await new Promise((r) => setTimeout(r, 30))
      const creado = { alegraId: String(siguiente++), code: input.code, name: input.name } as AlegraProduct
      items[cuentaDe(c)].push(creado)
      creaciones.push({ cuenta: cuentaDe(c), input })
      return creado
    },
    listTaxes: async () => TAXES,
  }
  return { deps, items, creaciones }
}

const cfgMdp = { ...cfg, alegraToken: "tok-mdp" } as TenantConfig

async function sembrarProducto(alegraId: string, code: string | null, over: { cuentaId?: string; alegraIdCuenta?: string } = {}) {
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, cuenta_id, alegra_id_cuenta)
    VALUES (${A}, ${alegraId}, ${code}, ${`Producto ${code ?? alegraId}`}, 'active', ${over.cuentaId ?? null}::uuid, ${over.alegraIdCuenta ?? null})
  `)
}
async function sembrarStock(sucursal: string, alegraId: string, itemIdCuenta: string | null) {
  await db().execute(sql`
    INSERT INTO catalog_stock_sucursal (tenant_id, sucursal, alegra_id, item_id_cuenta, stock, origen)
    VALUES (${A}, ${sucursal}, ${alegraId}, ${itemIdCuenta}, 5, 'sync')
  `)
}
const stockDe = async (sucursal: string, alegraId: string) =>
  (await filas(sql`SELECT * FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = ${sucursal} AND alegra_id = ${alegraId}`))[0]

const linea = (alegraItemId: string, over: Partial<LineaParaCuenta> = {}): LineaParaCuenta => ({
  alegraItemId,
  nombre: `Línea ${alegraItemId}`,
  precioUnitario: 500,
  ivaPorcentaje: 21,
  ...over,
})

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'm@cliente.example', 'tok-mdp')`)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE tenant_id = ${A} AND slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE tenant_id = ${A} AND slug = 'mdp'`)
  const cuentas = await filas(sql`SELECT id, slug, nombre, principal FROM alegra_cuentas WHERE tenant_id = ${A}`)
  const de = (slug: string) => {
    const c = cuentas.find((x) => x.slug === slug)!
    return { id: c.id as string, slug: c.slug as string, nombre: c.nombre as string, principal: c.principal as boolean }
  }
  IGZ = de("principal")
  MDP = de("mdp")
  // P1: producto de IGZ pareado con el ítem 500 de MDP. SOLO1: producto que vive solo en MDP.
  await sembrarProducto("100", "LED-1")
  await sembrarProducto("mdp:900", "SOLO-1", { cuentaId: MDP.id, alegraIdCuenta: "900" })
  await sembrarStock("igz", "100", "100")
  await sembrarStock("mdp", "100", "500")
  await sembrarStock("mdp", "mdp:900", "900")
})

afterAll(async () => {
  await truncateAll()
})

describe("asegurarItemsEnCuenta: resuelve el id real sin hablar con Alegra cuando puede", () => {
  it("producto de IGZ pareado, facturado por MDP: usa el item_id_cuenta de MDP", async () => {
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("100")], f.deps)
    expect(r).toMatchObject({ ok: true, creados: [] })
    expect(r.ok && r.ids.get("100")).toBe("500")
    expect(f.creaciones).toHaveLength(0)
  })

  it("producto de IGZ facturado por IGZ: su propio id", async () => {
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("100")], f.deps)
    expect(r.ok && r.ids.get("100")).toBe("100")
  })

  it("solo-MDP facturado por MDP: el id real de MDP, nunca el sintético", async () => {
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("mdp:900")], f.deps)
    expect(r.ok && r.ids.get("mdp:900")).toBe("900")
    expect(f.creaciones).toHaveLength(0)
  })

  it("itemsSinIdEnCuenta (vista previa): sólo lista lo que hay que dar de alta", async () => {
    const lineas = [linea("100", { nombre: "P1" }), linea("mdp:900", { nombre: "Solo 1" })]
    expect(await itemsSinIdEnCuenta(A, MDP, lineas)).toEqual([])
    expect(await itemsSinIdEnCuenta(A, IGZ, lineas)).toEqual(["Solo 1"])
  })
})

describe("asegurarItemsEnCuenta: alta del ítem al facturar, en los dos sentidos", () => {
  it("solo-MDP facturado por IGZ: crea el ítem en IGZ (código, nombre, IVA y precio del pedido) y NO toca catalog_products", async () => {
    const antes = (await filas(sql`SELECT * FROM catalog_products WHERE tenant_id = ${A} AND alegra_id = 'mdp:900'`))[0]
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900", { precioUnitario: 1234.5, ivaPorcentaje: 21 })], f.deps)
    expect(r).toMatchObject({ ok: true, creados: ["mdp:900"] })
    expect(f.creaciones).toEqual([
      { cuenta: "igz", input: { name: "Producto SOLO-1", code: "SOLO-1", price: 1234.5, taxId: "1" } },
    ])
    const id = r.ok ? r.ids.get("mdp:900") : null
    expect(id).toBe("9000")
    expect(id).not.toContain(":")
    // Guardó el pareo para la próxima, sin stock y con origen 'factura'.
    expect(await stockDe("igz", "mdp:900")).toMatchObject({ item_id_cuenta: "9000", origen: "factura", stock: "0" })
    // La fila del catálogo quedó igual.
    const despues = (await filas(sql`SELECT * FROM catalog_products WHERE tenant_id = ${A} AND alegra_id = 'mdp:900'`))[0]
    expect(despues).toEqual(antes)
  })

  it("producto de IGZ que MDP no tiene: lo crea en MDP", async () => {
    await db().execute(sql`DELETE FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = 'mdp' AND alegra_id = '100'`)
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("100")], f.deps)
    expect(r).toMatchObject({ ok: true, creados: ["100"] })
    expect(f.creaciones.map((c) => c.cuenta)).toEqual(["mdp"])
    expect(await stockDe("mdp", "100")).toMatchObject({ item_id_cuenta: "9000", origen: "factura" })
  })

  it("si el ítem ya existe en la cuenta por código (nunca pareado): lo reutiliza, no lo crea ni lo modifica", async () => {
    await db().execute(sql`DELETE FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = 'mdp' AND alegra_id = '100'`)
    const f = alegraFalsa({ mdp: [{ alegraId: "777", code: "led-1", name: "Otro nombre en MDP" } as AlegraProduct] })
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("100")], f.deps)
    expect(r).toMatchObject({ ok: true, creados: [] })
    expect(r.ok && r.ids.get("100")).toBe("777")
    expect(f.creaciones).toHaveLength(0)
    expect(await stockDe("mdp", "100")).toMatchObject({ item_id_cuenta: "777" })
  })

  it("reintento: la segunda emisión encuentra lo que dejó la primera y no duplica", async () => {
    const f = alegraFalsa()
    await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900")], f.deps)
    const r2 = await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900")], f.deps)
    expect(r2).toMatchObject({ ok: true, creados: [] })
    expect(f.creaciones).toHaveLength(1)
  })

  it("reintento tras un fallo posterior al alta (el pareo no llegó a guardarse): lo reencuentra por código", async () => {
    const f = alegraFalsa({ igz: [{ alegraId: "8888", code: "SOLO-1", name: "Producto SOLO-1" } as AlegraProduct] })
    const r = await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900")], f.deps)
    expect(r.ok && r.ids.get("mdp:900")).toBe("8888")
    expect(f.creaciones).toHaveLength(0)
  })

  it("dos emisiones simultáneas del mismo producto: se crea UN solo ítem", async () => {
    const f = alegraFalsa()
    const [a, b] = await Promise.all([
      asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900")], f.deps),
      asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900")], f.deps),
    ])
    expect(f.creaciones).toHaveLength(1)
    expect(a.ok && b.ok && a.ids.get("mdp:900")).toBe(b.ok ? b.ids.get("mdp:900") : null)
    expect(f.items.igz).toHaveLength(1)
  })

  it("código duplicado en la cuenta destino: aborta con mensaje, sin crear ni elegir uno", async () => {
    await db().execute(sql`DELETE FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND sucursal = 'mdp' AND alegra_id = '100'`)
    const f = alegraFalsa({
      mdp: [
        { alegraId: "1", code: "LED-1", name: "a" } as AlegraProduct,
        { alegraId: "2", code: "LED-1", name: "b" } as AlegraProduct,
      ],
    })
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("100")], f.deps)
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("repetido") })
    expect(f.creaciones).toHaveLength(0)
  })

  it("IVA sin impuesto equivalente en la cuenta destino: no se da de alta y avisa", async () => {
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900", { ivaPorcentaje: 10.5 })], f.deps)
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("10.5%") })
    expect(f.creaciones).toHaveLength(0)
  })

  it("falla la creación en Alegra: el error se propaga y no queda pareo guardado", async () => {
    const f = alegraFalsa()
    f.deps.crearItem = async () => {
      throw new Error("alegra caída")
    }
    await expect(asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:900")], f.deps)).rejects.toThrow("alegra caída")
    expect(await stockDe("igz", "mdp:900")).toBeUndefined()
  })

  it("producto que ya no está en el catálogo, facturado por otra cuenta: avisa", async () => {
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfgMdp, MDP, [linea("999-fantasma", { nombre: "Fantasma" })], f.deps)
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Fantasma") })
  })

  it("ítem sin código: se crea con el nombre y sin referencia", async () => {
    await sembrarProducto("mdp:901", null, { cuentaId: MDP.id, alegraIdCuenta: "901" })
    const f = alegraFalsa()
    const r = await asegurarItemsEnCuenta(A, cfg, IGZ, [linea("mdp:901")], f.deps)
    expect(r.ok).toBe(true)
    expect(f.creaciones[0].input).toMatchObject({ code: null, name: "Producto mdp:901" })
  })
})

describe("asegurarItemsEnCuenta: vista previa sin efectos", () => {
  it("itemsSinIdEnCuenta no escribe nada", async () => {
    const antes = await filas(sql`SELECT count(*)::int AS n FROM catalog_stock_sucursal WHERE tenant_id = ${A}`)
    await itemsSinIdEnCuenta(A, IGZ, [linea("mdp:900")])
    expect(await filas(sql`SELECT count(*)::int AS n FROM catalog_stock_sucursal WHERE tenant_id = ${A}`)).toEqual(antes)
  })
})

