import { beforeEach, describe, expect, it, vi } from "vitest"

// Qué credenciales de Alegra usa cada operación de facturas y remitos de un pedido: las de la
// cuenta principal si el pedido sale de la sucursal principal, las de la segunda cuenta (MDP) si
// sale de MDP. Alegra, la DB, el guard y el tenant están simulados: se mira con qué config se
// llama al cliente de Alegra. Datos inventados.

const TENANT = "tenant-a"
const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111"
const MDP_ID = "22222222-2222-4222-8222-222222222222"
const TOKEN_PRINCIPAL = "tok-principal-ficticio"
const TOKEN_MDP = "tok-mdp-ficticio"

const baseConfig = {
  id: TENANT,
  name: "Tienda Demo",
  alegraEmail: "principal@alegra.example",
  alegraToken: TOKEN_PRINCIPAL,
  alegraMock: false,
}

const cuentaRow = (over: Record<string, unknown>) => ({
  tenantId: TENANT,
  nombre: "Cuenta",
  cuit: "",
  alegraEmail: "",
  alegraToken: "",
  alegraMock: false,
  principal: false,
  activa: true,
  ...over,
})
const contexto = () => ({
  cuentas: [
    cuentaRow({ id: PRINCIPAL_ID, slug: "principal", nombre: "Principal", principal: true }),
    cuentaRow({ id: MDP_ID, slug: "mdp", nombre: "Mar del Plata", alegraEmail: "mdp@alegra.example", alegraToken: TOKEN_MDP }),
  ],
  sucursales: [
    { slug: "igz", nombre: "Iguazú", cuentaAlegraId: PRINCIPAL_ID },
    { slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: MDP_ID },
  ],
  principalId: PRINCIPAL_ID,
  fila: null,
})

const getPedido = vi.fn()
const getFacturaPorId = vi.fn()
const getRemisionPorId = vi.fn()
const getDocumentPdf = vi.fn()
const listNumberTemplates = vi.fn()
const vincularFactura = vi.fn()
const vincularRemito = vi.fn()
const asegurarItemsEnCuenta = vi.fn()
const getTenantByIdFromDb = vi.fn()
const cargarContextoCuentaFactura = vi.fn()

const guard = { ok: true, tenantId: TENANT, user: { id: "u1", name: "Operador", email: "op@tienda.example", role: "admin" } }

vi.mock("@/lib/admin-route-guard", () => ({
  requireAdminPlus: async () => guard,
  requireOperatorPlus: async () => guard,
  adminNotFoundResponse: () => Response.json({ error: "not found" }, { status: 404 }),
}))
vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  getFacturaPorId: (...a: unknown[]) => getFacturaPorId(...a),
  getRemisionPorId: (...a: unknown[]) => getRemisionPorId(...a),
  getDocumentPdf: (...a: unknown[]) => getDocumentPdf(...a),
  listNumberTemplates: (...a: unknown[]) => listNumberTemplates(...a),
}))
vi.mock("@/lib/alegra-items-cuenta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra-items-cuenta")>()),
  asegurarItemsEnCuenta: (...a: unknown[]) => asegurarItemsEnCuenta(...a),
}))
vi.mock("@/lib/pedidos-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedidos-repo")>()),
  getPedido: (...a: unknown[]) => getPedido(...a),
  vincularFactura: (...a: unknown[]) => vincularFactura(...a),
  vincularRemito: (...a: unknown[]) => vincularRemito(...a),
  toPedidoDetalleDto: () => ({ ok: true }),
}))
vi.mock("@/lib/pedido-factura-cuenta-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedido-factura-cuenta-repo")>()),
  cargarContextoCuentaFactura: (...a: unknown[]) => cargarContextoCuentaFactura(...a),
}))
vi.mock("@/lib/pedido-factura-aviso", () => ({
  enviarFacturaPedido: async () => ({ resultado: "enviado", destino: "a***@cliente.example" }),
  logAvisoFactura: () => {},
}))
vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: (...a: unknown[]) => getTenantByIdFromDb(...a) }))

const facturaRoute = await import("@/app/api/admin/pedidos/[id]/factura/route")
const facturaEmitir = await import("@/app/api/admin/pedidos/[id]/factura/emitir/route")
const remitoRoute = await import("@/app/api/admin/pedidos/[id]/remito/route")
const remitoPdf = await import("@/app/api/admin/pedidos/[id]/remito/pdf/route")
const remitoEmitir = await import("@/app/api/admin/pedidos/[id]/remito/emitir/route")

const ID = "33333333-3333-4333-8333-333333333333"
const params = { params: Promise.resolve({ id: ID }) }
const post = (body: unknown) => new Request("https://admin.example/x", { method: "POST", body: JSON.stringify(body) })
const get = () => new Request("https://admin.example/x")

const pedido = (sucursal: "igz" | "mdp", over: Record<string, unknown> = {}) => ({
  id: ID,
  numero: 123,
  estado: "pendiente",
  sucursal,
  sucursalRegla: null,
  clienteCodigo: "55",
  clienteEmail: "ana@cliente.example",
  facturaAlegraId: null,
  facturaNumero: null,
  ...over,
})
const item = { name: "Producto demo", alegraItemId: "900", qty: "1", precioUnitario: "100", ivaPorcentaje: "21" }
const encontrado = (p: ReturnType<typeof pedido>, extra: Record<string, unknown> = {}) => ({
  pedido: p,
  items: [item],
  remito: null,
  ...extra,
})

/** Token de la config con la que se llamó al cliente de Alegra (argumento `pos`). */
const tokenUsado = (fn: ReturnType<typeof vi.fn>, pos = 0) =>
  (fn.mock.calls[0]?.[pos] as { alegraToken: string } | undefined)?.alegraToken

beforeEach(() => {
  for (const m of [getPedido, getFacturaPorId, getRemisionPorId, getDocumentPdf, listNumberTemplates, vincularFactura, vincularRemito, asegurarItemsEnCuenta]) m.mockReset()
  getTenantByIdFromDb.mockReset().mockResolvedValue({ ...baseConfig })
  cargarContextoCuentaFactura.mockReset().mockImplementation(async () => contexto())
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

describe("emitir factura: cuenta de la sucursal", () => {
  // Con una numeración inexistente corta en 422 justo después de listarlas, sin escribir nada.
  const emitir = () => facturaEmitir.POST(post({ numberTemplateId: "no-existe" }), params)

  it("pedido de la sucursal principal → credenciales principales", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("igz")))
    listNumberTemplates.mockResolvedValue([])
    const res = await emitir()
    expect(res.status).toBe(422)
    expect(tokenUsado(listNumberTemplates)).toBe(TOKEN_PRINCIPAL)
  })

  it("pedido de MDP → credenciales de MDP", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("mdp")))
    listNumberTemplates.mockResolvedValue([])
    const res = await emitir()
    expect(res.status).toBe(422)
    expect(tokenUsado(listNumberTemplates)).toBe(TOKEN_MDP)
  })
})

describe("vincular factura (POST): lee la factura en Alegra", () => {
  const vincular = () => facturaRoute.POST(post({ alegraId: "7040" }), params)

  it("pedido de la sucursal principal → credenciales principales", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("igz")))
    getFacturaPorId.mockResolvedValue(null)
    const res = await vincular()
    expect(res.status).toBe(422)
    expect(tokenUsado(getFacturaPorId)).toBe(TOKEN_PRINCIPAL)
  })

  it("pedido de MDP → credenciales de MDP", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("mdp")))
    getFacturaPorId.mockResolvedValue(null)
    await vincular()
    expect(tokenUsado(getFacturaPorId)).toBe(TOKEN_MDP)
  })
})

describe("vincular remito (POST): lee el remito en Alegra", () => {
  const vincular = () => remitoRoute.POST(post({ alegraId: "800" }), params)

  it("pedido de la sucursal principal → credenciales principales", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("igz")))
    getRemisionPorId.mockResolvedValue(null)
    const res = await vincular()
    expect(res.status).toBe(422)
    expect(tokenUsado(getRemisionPorId)).toBe(TOKEN_PRINCIPAL)
  })

  it("pedido de MDP → credenciales de MDP", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("mdp")))
    getRemisionPorId.mockResolvedValue(null)
    await vincular()
    expect(tokenUsado(getRemisionPorId)).toBe(TOKEN_MDP)
  })
})

describe("PDF del remito", () => {
  const remito = { remitoAlegraId: "800", remitoNumero: "R-0001" }
  // Sin URL de PDF responde 409 sin bajar nada de la red.
  const pdf = () => remitoPdf.GET(get(), params)

  it("pedido de la sucursal principal → credenciales principales", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("igz"), { remito }))
    getDocumentPdf.mockResolvedValue({ pdfUrl: null })
    const res = await pdf()
    expect(res.status).toBe(409)
    expect(tokenUsado(getDocumentPdf)).toBe(TOKEN_PRINCIPAL)
    expect(getDocumentPdf.mock.calls[0].slice(1)).toEqual(["remision", "800"])
  })

  it("pedido de MDP → credenciales de MDP", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("mdp"), { remito }))
    getDocumentPdf.mockResolvedValue({ pdfUrl: null })
    await pdf()
    expect(tokenUsado(getDocumentPdf)).toBe(TOKEN_MDP)
  })
})

describe("emitir remito: cuenta de la sucursal", () => {
  // `asegurarItemsEnCuenta` en error corta en 422 antes de crear nada en Alegra (config = 2º arg).
  const emitir = () => remitoEmitir.POST(post({}), params)

  it("pedido de la sucursal principal → credenciales principales", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("igz")))
    asegurarItemsEnCuenta.mockResolvedValue({ ok: false, error: "sin ítem" })
    const res = await emitir()
    expect(res.status).toBe(422)
    expect(tokenUsado(asegurarItemsEnCuenta, 1)).toBe(TOKEN_PRINCIPAL)
  })

  it("pedido de MDP → credenciales de MDP", async () => {
    getPedido.mockResolvedValue(encontrado(pedido("mdp")))
    asegurarItemsEnCuenta.mockResolvedValue({ ok: false, error: "sin ítem" })
    const res = await emitir()
    expect(res.status).toBe(422)
    expect(tokenUsado(asegurarItemsEnCuenta, 1)).toBe(TOKEN_MDP)
  })
})
