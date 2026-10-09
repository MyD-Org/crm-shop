import { beforeEach, describe, expect, it, vi } from "vitest"

// Emitir factura de un pedido cobrado en línea (change `cuentas-procesador-por-sucursal`, R3): si la
// cuenta de Alegra con la que se factura no es la de la sucursal que cobró, la vista previa avisa
// (`cuenta.avisoCobro`, que NO bloquea) y el POST exige `confirmarCuentaDistintaDeCobro: true`.
// Alegra, la DB, el guard y el tenant están simulados. Datos inventados.

const TENANT = "tenant-a"
const A_IGZ = "11111111-1111-4111-8111-111111111111"
const A_MDP = "22222222-2222-4222-8222-222222222222"

const cuentaRow = (over: Record<string, unknown>) => ({
  tenantId: TENANT,
  nombre: "Cuenta",
  cuit: "",
  alegraEmail: "a@alegra.example",
  alegraToken: "tok-ficticio",
  alegraMock: false,
  principal: false,
  activa: true,
  ...over,
})
const contexto = (sucursales?: unknown[]) => ({
  cuentas: [
    cuentaRow({ id: A_IGZ, slug: "principal", nombre: "Iguazú SA", principal: true }),
    cuentaRow({ id: A_MDP, slug: "mdp", nombre: "Mar del Plata SA" }),
  ],
  sucursales: sucursales ?? [
    { slug: "igz", nombre: "Iguazú", cuentaAlegraId: A_IGZ },
    { slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: A_MDP },
  ],
  principalId: A_IGZ,
  fila: null,
})

const getPedido = vi.fn()
const listNumberTemplates = vi.fn()
const resolverPreviewEmision = vi.fn()
const itemsSinIdEnCuenta = vi.fn()
const guardarCuentaElegida = vi.fn()
const reservarEmisionFactura = vi.fn()
const cargarContextoCuentaFactura = vi.fn()

const guard = { ok: true, tenantId: TENANT, user: { id: "u1", name: "Operador", email: "op@tienda.example", role: "admin" } }

vi.mock("@/lib/admin-route-guard", () => ({
  requireAdminPlus: async () => guard,
  adminNotFoundResponse: () => Response.json({ error: "not found" }, { status: 404 }),
}))
vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  listNumberTemplates: (...a: unknown[]) => listNumberTemplates(...a),
  listTaxes: async () => [],
  findContactByIdentifier: async () => null,
}))
vi.mock("@/lib/alegra-items-cuenta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra-items-cuenta")>()),
  itemsSinIdEnCuenta: (...a: unknown[]) => itemsSinIdEnCuenta(...a),
}))
vi.mock("@/lib/factura-emitir", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/factura-emitir")>()),
  resolverPreviewEmision: (...a: unknown[]) => resolverPreviewEmision(...a),
}))
vi.mock("@/lib/pedidos-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedidos-repo")>()),
  getPedido: (...a: unknown[]) => getPedido(...a),
  reservarEmisionFactura: (...a: unknown[]) => reservarEmisionFactura(...a),
}))
vi.mock("@/lib/pedido-factura-cuenta-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedido-factura-cuenta-repo")>()),
  cargarContextoCuentaFactura: (...a: unknown[]) => cargarContextoCuentaFactura(...a),
  guardarCuentaElegida: (...a: unknown[]) => guardarCuentaElegida(...a),
}))
vi.mock("@/lib/tenants", () => ({
  getTenantByIdFromDb: async () => ({ id: TENANT, name: "Tienda Demo", alegraEmail: "p@alegra.example", alegraToken: "tok-principal", alegraMock: false }),
}))

const emitir = await import("@/app/api/admin/pedidos/[id]/factura/emitir/route")

const ID = "33333333-3333-4333-8333-333333333333"
const params = { params: Promise.resolve({ id: ID }) }
const post = (body: unknown) => new Request("https://admin.example/x", { method: "POST", body: JSON.stringify(body) })
const get = (cuenta?: string) => new Request(`https://admin.example/x${cuenta ? `?cuenta=${cuenta}` : ""}`)

const pedido = (over: Record<string, unknown> = {}) => ({
  id: ID,
  numero: 123,
  estado: "pendiente",
  sucursal: "mdp",
  sucursalRegla: null,
  clienteCodigo: "55",
  clienteEmail: "ana@cliente.example",
  facturaAlegraId: null,
  facturaNumero: null,
  pagoEstado: "pagado",
  pagoProveedor: "mercadopago",
  pagoInfo: { cuentaCobro: "mdp" },
  ...over,
})
const encontrado = (p: ReturnType<typeof pedido>) => ({ pedido: p, items: [], remito: null })

beforeEach(() => {
  for (const m of [getPedido, listNumberTemplates, resolverPreviewEmision, itemsSinIdEnCuenta, guardarCuentaElegida, reservarEmisionFactura]) m.mockReset()
  cargarContextoCuentaFactura.mockReset().mockImplementation(async () => contexto())
  listNumberTemplates.mockResolvedValue([])
  resolverPreviewEmision.mockResolvedValue({
    lineas: [],
    total: 0,
    totalPedido: 0,
    numeraciones: [],
    numeracionSugeridaId: null,
    contacto: { alegraId: null, esNuevo: false, nombre: "Ana" },
    bloqueo: null,
    avisos: [],
  })
  itemsSinIdEnCuenta.mockResolvedValue([])
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

describe("vista previa de emitir: aviso de cuenta de cobro", () => {
  it("cuenta coincide con la que cobró → sin avisoCobro", async () => {
    getPedido.mockResolvedValue(encontrado(pedido()))
    const body = await (await emitir.GET(get(), params)).json()
    expect(body.cuenta.avisoCobro).toBeNull()
  })

  it("override a otra cuenta → avisoCobro, y NO entra en avisos[] (que bloquean)", async () => {
    getPedido.mockResolvedValue(encontrado(pedido()))
    const res = await emitir.GET(get("principal"), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.cuenta.avisoCobro).toEqual({
      cobradoCon: { slug: "mdp", nombre: "Mar del Plata" },
      facturaCon: { slug: "principal", nombre: "Iguazú SA" },
    })
    expect(body.avisos).toEqual([])
  })

  it("fallback: cobró igz con prevista mdp y la factura va por defecto a mdp → aviso contra igz", async () => {
    getPedido.mockResolvedValue(encontrado(pedido({ pagoInfo: { cuentaCobro: "igz", cuentaCobroPrevista: "mdp" } })))
    const body = await (await emitir.GET(get(), params)).json()
    expect(body.cuenta.avisoCobro.cobradoCon.slug).toBe("igz")
    expect(body.cuenta.avisoCobro.facturaCon.slug).toBe("mdp")
  })

  it("sin pago en línea o pago anterior sin cuentaCobro → sin aviso", async () => {
    getPedido.mockResolvedValue(encontrado(pedido({ pagoProveedor: null, pagoInfo: null })))
    expect((await (await emitir.GET(get("principal"), params)).json()).cuenta.avisoCobro).toBeNull()
    getPedido.mockResolvedValue(encontrado(pedido({ pagoInfo: { tipo: "credito" } })))
    expect((await (await emitir.GET(get("principal"), params)).json()).cuenta.avisoCobro).toBeNull()
  })

  it("la sucursal de cobro sin cuenta de Alegra → sin aviso ni bloqueo", async () => {
    cargarContextoCuentaFactura.mockImplementation(async () =>
      contexto([
        { slug: "igz", nombre: "Iguazú", cuentaAlegraId: A_IGZ },
        { slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: null },
      ]),
    )
    getPedido.mockResolvedValue(encontrado(pedido({ sucursal: "igz" })))
    const res = await emitir.GET(get(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).cuenta.avisoCobro).toBeNull()
  })
})

describe("POST emitir: confirmación de cuenta distinta de la que cobró", () => {
  const emite = (extra: Record<string, unknown> = {}) =>
    emitir.POST(post({ numberTemplateId: "no-existe", cuenta: "principal", ...extra }), params)

  it("sin confirmación → 409, no consulta Alegra ni guarda la cuenta elegida", async () => {
    getPedido.mockResolvedValue(encontrado(pedido()))
    const res = await emite()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("confirmar_cuenta_distinta_de_cobro")
    expect(body.error).toBe("Confirme que desea facturar con una cuenta distinta de la que cobró el pago.")
    expect(listNumberTemplates).not.toHaveBeenCalled()
    expect(reservarEmisionFactura).not.toHaveBeenCalled()
    expect(guardarCuentaElegida).not.toHaveBeenCalled()
  })

  it("confirmación distinta de true (string, 1) → 409", async () => {
    getPedido.mockResolvedValue(encontrado(pedido()))
    expect((await emite({ confirmarCuentaDistintaDeCobro: "true" })).status).toBe(409)
    expect((await emite({ confirmarCuentaDistintaDeCobro: 1 })).status).toBe(409)
  })

  it("con confirmación sigue adelante (no bloquea)", async () => {
    getPedido.mockResolvedValue(encontrado(pedido()))
    const res = await emite({ confirmarCuentaDistintaDeCobro: true })
    // Sigue hasta validar la numeración (inexistente a propósito): 422, no 409.
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe("numeracion_invalida")
    expect(listNumberTemplates).toHaveBeenCalled()
  })

  it("cuenta coincide con la que cobró → emite sin confirmación", async () => {
    getPedido.mockResolvedValue(encontrado(pedido()))
    const res = await emite({ cuenta: "mdp" })
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe("numeracion_invalida")
  })

  it("sin pago en línea o pago viejo sin cuentaCobro → no pide confirmación", async () => {
    getPedido.mockResolvedValue(encontrado(pedido({ pagoProveedor: null, pagoInfo: null })))
    expect((await emite()).status).toBe(422)
    getPedido.mockResolvedValue(encontrado(pedido({ pagoInfo: {} })))
    expect((await emite()).status).toBe(422)
  })

  it("el servidor revalida: no confía en el preview (fallback sin override también exige confirmar)", async () => {
    getPedido.mockResolvedValue(encontrado(pedido({ pagoInfo: { cuentaCobro: "igz", cuentaCobroPrevista: "mdp" } })))
    const res = await emitir.POST(post({ numberTemplateId: "no-existe" }), params)
    expect(res.status).toBe(409)
  })
})
