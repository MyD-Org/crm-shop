import { beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraItemCompraInput, AlegraPriceList, AlegraProduct, AlegraTax } from "@/lib/alegra"
import type { CuentaDestino } from "@/lib/alegra-items-cuenta"
import { ErrorCompras } from "@/lib/compras-dinero"
import { copiarProductoACuenta, DEPS_ALTA_REALES, type DepsAlta } from "@/lib/compras-producto-alta"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

// «Copiar a <cuenta>» (S4b) contra Postgres real (crm_test) con Alegra inyectada: la regla de copia
// de la facturación (asegurarItemsEnCuenta) con el alta completa. Nada sale a Alegra real.

const A = "tenant-a"
const cfg = { id: A, alegraEmail: "x@cliente.example", alegraToken: "tok-mdp", alegraMock: false } as TenantConfig
const db = () => getDb()
let MDP: CuentaDestino

const LISTAS: AlegraPriceList[] = [
  { alegraId: "41", name: "General", type: null, status: "active" },
  { alegraId: "42", name: "L2", type: null, status: "active" },
]
const precios = [
  { id: "41", precio: 160 },
  { id: "42", precio: 140 },
]

function armar() {
  const enMdp: AlegraProduct[] = []
  const creados: AlegraItemCompraInput[] = []
  const deps: DepsAlta = {
    ...DEPS_ALTA_REALES,
    listasDeCuenta: async () => LISTAS,
    impuestos: async () => [{ alegraId: "9", name: "IVA 21%", percentage: 21, status: "active" } as AlegraTax],
    buscarPorCodigo: async (_c, codigo) => enMdp.filter((i) => (i.code ?? "").toLowerCase() === codigo.toLowerCase()),
    crearItem: async (_c, input) => {
      creados.push(input)
      const it = { alegraId: "9100", code: input.reference, name: input.name, status: "active" } as AlegraProduct
      enMdp.push(it)
      return it
    },
    registrarEnEspejo: async (_t, _c, _cfg, id) => ({ alegraId: id, espejado: true }),
    guardarAjustes: async (_t, _c, _i, a) => a.length,
  }
  return { deps, creados, enMdp }
}

async function sembrar(alegraId: string, code: string | null, costo: number | null) {
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, brand, iva_porcentaje, costo, status)
    VALUES (${A}, ${alegraId}, ${code}, ${`Producto ${alegraId}`}, 'Macroled', 21, ${costo}, 'active')
  `)
}

const codigo = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof ErrorCompras ? e.codigo : `otro: ${String(e)}`
  }
  return null
}

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'm@cliente.example', 'tok-mdp')`)
  const [m] = [...(await db().execute(sql`SELECT id, slug, nombre, principal FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'`))] as { id: string; slug: string; nombre: string; principal: boolean }[]
  MDP = m
})

describe("copiarProductoACuenta (DB real)", () => {
  it("sin confirmar no crea nada", async () => {
    await sembrar("10", "LED9W-MCL", 100)
    const { deps, creados } = armar()
    expect(await codigo(copiarProductoACuenta(A, MDP, cfg, { cuenta: "mdp", alegraId: "10", precios, confirmar: false }, deps))).toBe("confirmacion_requerida")
    expect(creados).toHaveLength(0)
  })

  it("crea en la cuenta con costo, referencia del catálogo y todas las listas", async () => {
    await sembrar("10", "LED9W-MCL", 100)
    const { deps, creados } = armar()
    const r = await copiarProductoACuenta(A, MDP, cfg, { cuenta: "mdp", alegraId: "10", precios, confirmar: true }, deps)
    expect(creados).toHaveLength(1)
    expect(creados[0]).toMatchObject({ reference: "LED9W-MCL", unitCost: 100, unit: "unit", taxId: "9", brand: "Macroled" })
    expect(creados[0].prices).toEqual([
      { idPriceList: "41", price: 160 },
      { idPriceList: "42", price: 140 },
    ])
    expect(r).toMatchObject({ alegraId: "10", itemIdCuenta: "9100", yaExistia: false, ajustes: [] })
  })

  it("segunda copia (doble clic): encuentra el ítem y no crea otro", async () => {
    await sembrar("10", "LED9W-MCL", 100)
    const { deps, creados } = armar()
    await copiarProductoACuenta(A, MDP, cfg, { cuenta: "mdp", alegraId: "10", precios, confirmar: true }, deps)
    const r2 = await copiarProductoACuenta(A, MDP, cfg, { cuenta: "mdp", alegraId: "10", precios, confirmar: true }, deps)
    expect(creados).toHaveLength(1)
    expect(r2).toMatchObject({ yaExistia: true, itemIdCuenta: "9100" })
  })

  it("guarda como ajuste la lista cuyo % se editó", async () => {
    await sembrar("10", "LED9W-MCL", 100)
    const { deps } = armar()
    const r = await copiarProductoACuenta(A, MDP, cfg, { cuenta: "mdp", alegraId: "10", precios: [{ id: "41", precio: 160 }, { id: "42", precio: 150 }], confirmar: true }, deps)
    expect(r.ajustes).toEqual([{ listaId: "42", porcentaje: 50 }])
    expect(r.ajustesGuardados).toBe(1)
  })

  it("sin costo en el catálogo: bloquea en lugar de dejar listas en 0", async () => {
    await sembrar("11", "SINCOSTO-MCL", null)
    const { deps, creados } = armar()
    expect(await codigo(copiarProductoACuenta(A, MDP, cfg, { cuenta: "mdp", alegraId: "11", precios, confirmar: true }, deps))).toBe("sin_costo")
    expect(creados).toHaveLength(0)
  })
})
