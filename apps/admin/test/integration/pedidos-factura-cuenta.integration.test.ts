import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { pedidoFacturaCuenta, tenants } from "@/db/schema"
import { shopOrders } from "@/db/shop-schema"
import { __clearNumberTemplatesCache, __clearTaxesCache } from "@/lib/alegra"
import { desvincularFactura } from "@/lib/pedidos-repo"
import { crearSucursal } from "@/lib/sucursales-repo"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedShopOrder, seedShopOrderItem, seedTenant, truncateAll } from "./helpers"

// Cuenta que factura el pedido (change `sucursales-igz-mdp`, rebanada D, lote 3), de punta a punta
// por las rutas de emitir factura y remito. Todo en modo mock: el tenant (IGZ, la principal) y la
// cuenta `mdp` son mock, así que NADA sale a la red. Datos inventados.

let session: Record<string, unknown>
vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { createInvoiceSpy, createRemissionSpy } = vi.hoisted(() => ({ createInvoiceSpy: vi.fn(), createRemissionSpy: vi.fn() }))
vi.mock("@/lib/alegra", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/alegra")>()
  return {
    ...real,
    createInvoice: (...a: Parameters<typeof real.createInvoice>) => {
      createInvoiceSpy(...a)
      return real.createInvoice(...a)
    },
    createRemission: (...a: Parameters<typeof real.createRemission>) => {
      createRemissionSpy(...a)
      return real.createRemission(...a)
    },
  }
})

const factura = await import("@/app/api/admin/pedidos/[id]/factura/emitir/route")
const cuentaRoute = await import("@/app/api/admin/pedidos/[id]/factura/cuenta/route")
const remito = await import("@/app/api/admin/pedidos/[id]/remito/emitir/route")

const A = "tenant-a"
const db = () => getDb()
type Fila = Record<string, unknown>
const filas = async (q: ReturnType<typeof sql>): Promise<Fila[]> => [...(await db().execute(q))] as Fila[]

const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://${A}.localhost${path}`, { headers: { host: `${A}.localhost`, "content-type": "application/json" }, ...init })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const base = (id: string) => `/api/admin/pedidos/${id}/factura`
const previewF = (id: string, cuenta?: string) =>
  factura.GET(req(`${base(id)}/emitir${cuenta ? `?cuenta=${cuenta}` : ""}`), idParams(id))
const emitirF = (id: string, body: unknown) =>
  factura.POST(req(`${base(id)}/emitir`, { method: "POST", body: JSON.stringify(body) }), idParams(id))
const emitirR = (id: string) => remito.POST(req(`/api/admin/pedidos/${id}/remito/emitir`, { method: "POST" }), idParams(id))
const previewR = (id: string) => remito.GET(req(`/api/admin/pedidos/${id}/remito/emitir`), idParams(id))
const cuentaDto = (id: string) => cuentaRoute.GET(req(`${base(id)}/cuenta`), idParams(id))

function login(userId: string, role: "operator" | "admin" = "admin", name = "Admin A") {
  session = { userId, role, tenantId: A, name, email: "c@example.com", save: async () => {} }
}

let idMdp: string
let idIgz: string
let adminId: string
let operatorId: string

const regla = (over: Record<string, unknown> = {}) => ({
  v: 1,
  regla: "zona:misiones",
  motivo: "zona",
  provincia: "misiones",
  zonaId: null,
  sucursalZona: "igz",
  facturaSucursal: null,
  lineasATraer: [],
  ...over,
})

async function pedido(over: Parameters<typeof seedShopOrder>[1] = {}, item: Partial<Parameters<typeof seedShopOrderItem>[1]> = {}) {
  const p = await seedShopOrder(A, {
    estado: "confirmado",
    clienteCodigo: "ct-3",
    facturacionTipoDoc: "CUIT",
    facturacionNroDoc: "30587654321", // == mockContacts ct-3
    ...over,
  })
  await seedShopOrderItem(p.id, { alegraItemId: "it-1", qty: "2.000", precioUnitario: "500.00", ivaPorcentaje: "21.00", ...item })
  return p
}

const fila = async (orderId: string) =>
  (await db().select().from(pedidoFacturaCuenta).where(eq(pedidoFacturaCuenta.orderId, orderId)))[0]

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch inesperado: todo va en modo mock") }))
  __clearNumberTemplatesCache()
  __clearTaxesCache()
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_stock_sucursal, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().update(tenants).set({ alegraMock: true }).where(eq(tenants.id, A))
  invalidateTenantRegistry()
  adminId = await seedOperator(A, { role: "admin", name: "Admin A", email: "admin@example.com" })
  operatorId = await seedOperator(A, { role: "operator", name: "Ope Rador", email: "ope@example.com" })
  login(adminId)

  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú SRL', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_mock) VALUES (${A}, 'mdp', 'Mar del Plata SA', true)`)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal) WHERE slug = 'igz'`)
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE slug = 'mdp'`)
  ;[{ id: idIgz }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND principal`)) as { id: string }[]
  ;[{ id: idMdp }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'`)) as { id: string }[]
  // it-1 del mock: producto de la principal (código del fixture) y solo-MDP con id sintético.
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status)
    VALUES (${A}, 'it-1', 'LED-12W-FRIA', 'Lámpara LED 12W', 'active')
  `)
})

afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await truncateAll()
})

describe("cuenta que factura: la calculada", () => {
  it("por defecto factura la cuenta de la sucursal que despacha y se ve en el DTO", async () => {
    const p = await pedido({ sucursal: "mdp" })
    const res = await cuentaDto(p.id)
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.efectiva).toMatchObject({ slug: "mdp", nombre: "Mar del Plata SA", motivo: "despacho", texto: "Sucursal que despacha" })
    expect(dto.cruzada).toBe(false)
    expect(dto.editable).toBe(true)
    expect(dto.cuentas.map((c: { slug: string }) => c.slug).sort()).toEqual(["mdp", "principal"])
    // Nunca credenciales.
    expect(JSON.stringify(dto)).not.toMatch(/token|alegraEmail|alegra_email/i)
  })

  it("la zona que fuerza otra sucursal manda y la venta queda como entre empresas", async () => {
    const p = await pedido({ sucursal: "mdp", sucursalRegla: regla({ facturaSucursal: "igz" }) as never })
    const dto = await (await cuentaDto(p.id)).json()
    expect(dto.efectiva).toMatchObject({ slug: "principal", motivo: "zona", texto: "Por zona Misiones" })
    expect(dto.cruzada).toBe(true)
    expect(dto.despacha).toMatchObject({ sucursal: "Mar del Plata", cuentaNombre: "Mar del Plata SA" })
  })

  it("pedido anterior a las sucursales: la cuenta principal", async () => {
    const p = await pedido({ sucursal: null })
    const dto = await (await cuentaDto(p.id)).json()
    expect(dto.efectiva).toMatchObject({ slug: "principal", motivo: "principal" })
    expect(dto.cruzada).toBe(false)
  })

  it("operator puede ver la cuenta; sin pedido: 404", async () => {
    login(operatorId, "operator", "Ope Rador")
    const p = await pedido({ sucursal: "mdp" })
    expect((await cuentaDto(p.id)).status).toBe(200)
    expect((await cuentaDto("11111111-1111-4111-8111-111111111111")).status).toBe(404)
  })
})

describe("emitir factura por la cuenta que corresponde", () => {
  it("vista previa: incluye la cuenta, sus opciones y respeta ?cuenta=", async () => {
    const p = await pedido({ sucursal: "mdp" })
    const body = await (await previewF(p.id)).json()
    expect(body.cuenta.efectiva.slug).toBe("mdp")
    expect(body.cuenta.cuentas).toHaveLength(2)
    const otra = await (await previewF(p.id, "principal")).json()
    expect(otra.cuenta.efectiva).toMatchObject({ slug: "principal", texto: expect.any(String) })
    expect(otra.cuenta.cruzada).toBe(true)
    // La vista previa no escribe nada.
    expect(await fila(p.id)).toBeUndefined()
  })

  it("factura por la sucursal que despacha: usa SU cuenta y asienta la cuenta sin venta cruzada", async () => {
    const p = await pedido({ sucursal: "mdp" })
    const res = await emitirF(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(200)
    expect(createInvoiceSpy).toHaveBeenCalledTimes(1)
    const [cfgUsada, input] = createInvoiceSpy.mock.calls[0]
    // La cuenta `mdp` es mock: la config con la que se factura es la de ESA cuenta, no la del tenant.
    expect(cfgUsada).toMatchObject({ alegraMock: true, alegraEmail: "", alegraToken: "" })
    expect(input.items[0].alegraId).toBe("it-1") // buscado por código en la cuenta (mock) y reutilizado
    const f = await fila(p.id)
    expect(f).toMatchObject({ facturaCuentaId: idMdp, facturaCruzada: false, cuentaOverrideId: null })
  })

  it("zona que fuerza IGZ con despacho en MDP: factura por IGZ y marca factura_cruzada", async () => {
    const p = await pedido({ sucursal: "mdp", sucursalRegla: regla({ facturaSucursal: "igz" }) as never })
    expect((await emitirF(p.id, { numberTemplateId: "1" })).status).toBe(200)
    expect(await fila(p.id)).toMatchObject({ facturaCuentaId: idIgz, facturaCruzada: true })
    const dto = await (await cuentaDto(p.id)).json()
    expect(dto.emitida).toMatchObject({ slug: "principal", cruzada: true })
    expect(dto.cruzada).toBe(true)
    expect(dto.editable).toBe(false)
  })

  it("el operador elige otra cuenta: se guarda con quién, cuándo y la cuenta anterior", async () => {
    const p = await pedido({ sucursal: "mdp" })
    const res = await emitirF(p.id, { numberTemplateId: "1", cuenta: "principal" })
    expect(res.status).toBe(200)
    const f = await fila(p.id)
    expect(f).toMatchObject({
      cuentaOverrideId: idIgz,
      overridePorNombre: "Admin A",
      overrideAnteriorId: idMdp,
      facturaCuentaId: idIgz,
      facturaCruzada: true,
    })
    expect(f.overrideEn).toBeInstanceOf(Date)
    const dto = await (await cuentaDto(p.id)).json()
    expect(dto.override).toMatchObject({ por: "Admin A", anterior: "Mar del Plata SA" })
  })

  it("elegir la misma cuenta que ya correspondía no ensucia la auditoría", async () => {
    const p = await pedido({ sucursal: "mdp" })
    expect((await emitirF(p.id, { numberTemplateId: "1", cuenta: "mdp" })).status).toBe(200)
    expect((await fila(p.id)).cuentaOverrideId).toBeNull()
  })

  it("cuenta inexistente o inactiva: 422 sin llamar a Alegra ni reservar la factura", async () => {
    const p = await pedido({ sucursal: "mdp" })
    const res = await emitirF(p.id, { numberTemplateId: "1", cuenta: "no-existe" })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "sin_cuenta" })
    expect(createInvoiceSpy).not.toHaveBeenCalled()
    const [row] = await db().select().from(shopOrders).where(eq(shopOrders.id, p.id))
    expect(row.facturaAlegraId).toBeNull()
  })

  it("la sucursal no tiene cuenta: vista previa degradada y no se puede emitir", async () => {
    await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = NULL WHERE slug = 'mdp'`)
    const p = await pedido({ sucursal: "mdp" })
    const prev = await (await previewF(p.id)).json()
    expect(prev.avisos[0]).toMatchObject({ motivo: "sin_cuenta" })
    expect(prev.cuenta.efectiva).toBeNull()
    // Desde el mismo diálogo se puede elegir una cuenta y sigue el flujo.
    const conEleccion = await (await previewF(p.id, "principal")).json()
    expect(conEleccion.avisos).toEqual([])
    const res = await emitirF(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "sin_cuenta" })
  })

  it("cuenta secundaria sin credenciales: 422 con mensaje, sin llamar a Alegra", async () => {
    await db().execute(sql`UPDATE alegra_cuentas SET alegra_mock = false WHERE slug = 'mdp'`)
    const p = await pedido({ sucursal: "mdp" })
    const res = await emitirF(p.id, { numberTemplateId: "1" })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "cuenta_sin_credenciales", error: expect.stringContaining("credenciales") })
    expect(createInvoiceSpy).not.toHaveBeenCalled()
  })

  it("solo-MDP facturado por IGZ: el ítem se crea en IGZ y la factura NO lleva el id sintético", async () => {
    await db().execute(sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, cuenta_id, alegra_id_cuenta)
      VALUES (${A}, 'mdp:900', 'SOLO-1', 'Producto solo de MDP', 'active', ${idMdp}::uuid, '900')
    `)
    const p = await pedido({ sucursal: "mdp", sucursalRegla: regla({ facturaSucursal: "igz" }) as never }, { alegraItemId: "mdp:900" })
    const prev = await (await previewF(p.id)).json()
    expect(prev.cuenta.itemsACrear).toEqual(["Lámpara de prueba"])
    expect((await emitirF(p.id, { numberTemplateId: "1" })).status).toBe(200)
    const [, input] = createInvoiceSpy.mock.calls[0]
    expect(input.items[0].alegraId).toMatch(/^it-\d+$/)
    expect(input.items[0].alegraId).not.toContain(":")
    // Quedó el pareo guardado y la fila del catálogo intacta.
    const css = await filas(sql`SELECT item_id_cuenta, origen FROM catalog_stock_sucursal WHERE tenant_id = ${A} AND alegra_id = 'mdp:900' AND sucursal = 'igz'`)
    expect(css[0]).toMatchObject({ origen: "factura" })
    expect((await filas(sql`SELECT status, cuenta_id FROM catalog_products WHERE alegra_id = 'mdp:900'`))[0]).toMatchObject({ status: "active", cuenta_id: idMdp })
  })

  it("contacto en una cuenta distinta de la principal: NO reutiliza el cliente_codigo de la principal", async () => {
    // `cliente_codigo` es un id de la principal: en MDP no existe. Se busca por documento…
    const p = await pedido({ sucursal: "mdp", clienteCodigo: "id-de-la-principal" })
    const enMdp = await (await previewF(p.id)).json()
    expect(enMdp.contacto).toMatchObject({ alegraId: "ct-3", esNuevo: false })
    // …mientras que en la principal se usa tal cual, sin buscar.
    const enIgz = await (await previewF(p.id, "principal")).json()
    expect(enIgz.contacto).toMatchObject({ alegraId: "id-de-la-principal", esNuevo: false })
  })

  it("documento que la cuenta secundaria no conoce: el contacto es nuevo aunque el pedido tenga cliente_codigo", async () => {
    const p = await pedido({ sucursal: "mdp", clienteCodigo: "id-de-la-principal", facturacionNroDoc: "27555666777" })
    expect((await (await previewF(p.id)).json()).contacto).toMatchObject({ alegraId: null, esNuevo: true })
    expect((await emitirF(p.id, { numberTemplateId: "1" })).status).toBe(200)
    // Crear en una secundaria no escribe el espejo de contactos (padrón de la principal).
    const espejo = await filas(sql`SELECT count(*)::int AS n FROM alegra_contacts WHERE tenant_id = ${A}`)
    expect(espejo[0].n).toBe(0)
  })
})

describe("desvincular la factura", () => {
  it("limpia la cuenta con la que se emitió y conserva la elección del operador", async () => {
    const p = await pedido({ sucursal: "mdp" })
    await emitirF(p.id, { numberTemplateId: "1", cuenta: "principal" })
    expect((await fila(p.id)).facturaCuentaId).toBe(idIgz)
    const r = await desvincularFactura(A, p.id, { esperada: null, actor: { id: adminId, name: "Admin A" }, now: new Date() })
    expect(r.kind).toBe("ok")
    expect(await fila(p.id)).toMatchObject({ facturaCuentaId: null, facturaCruzada: false, cuentaOverrideId: idIgz })
  })
})

describe("remito en la cuenta de la factura", () => {
  it("con la factura emitida por MDP, el remito sale por MDP con el contacto de esa cuenta", async () => {
    const p = await pedido({ sucursal: "mdp", clienteCodigo: null })
    await emitirF(p.id, { numberTemplateId: "1" })
    const res = await emitirR(p.id)
    expect(res.status).toBe(200)
    expect(createRemissionSpy).toHaveBeenCalledTimes(1)
    const [cfgUsada, input] = createRemissionSpy.mock.calls[0]
    expect(cfgUsada).toMatchObject({ alegraMock: true, alegraEmail: "" })
    expect(input.items[0].alegraId).toBe("it-1")
    expect(input.contactAlegraId).toBeTruthy()
  })

  it("aunque el pedido corresponda a MDP, si se facturó por IGZ el remito sale por IGZ", async () => {
    const p = await pedido({ sucursal: "mdp" })
    await emitirF(p.id, { numberTemplateId: "1", cuenta: "principal" })
    expect((await previewR(p.id).then((r) => r.json())).cuenta).toMatchObject({ slug: "principal" })
    expect((await emitirR(p.id)).status).toBe(200)
  })

  it("sin cuenta que corresponda: el remito avisa y no emite", async () => {
    await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = NULL WHERE slug = 'mdp'`)
    const p = await pedido({ sucursal: "mdp" })
    const res = await emitirR(p.id)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "sin_cuenta" })
    expect(createRemissionSpy).not.toHaveBeenCalled()
  })

  it("con la cuenta principal el remito sigue exigiendo el cliente de Alegra, como antes", async () => {
    const p = await pedido({ sucursal: "igz", clienteCodigo: null })
    const res = await emitirR(p.id)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "sin_contacto" })
  })
})
