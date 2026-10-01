import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PedidoRow } from "@/lib/pedidos-repo"

// Mail "Su factura": con qué cuenta de Alegra se pide el PDF según la sucursal del pedido.
// Alegra, el tenant, el contexto de cuentas y Resend simulados; nada sale a la red. Datos inventados.

const TENANT = "tenant-a"
const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111"
const MDP_ID = "22222222-2222-4222-8222-222222222222"
const TOKEN_PRINCIPAL = "tok-principal-ficticio"
const TOKEN_MDP = "tok-mdp-ficticio"

const cuentaRow = (over: Record<string, unknown>) => ({
  tenantId: TENANT, nombre: "Cuenta", cuit: "", alegraEmail: "", alegraToken: "", alegraMock: false, principal: false, activa: true, ...over,
})
const contexto = () => ({
  cuentas: [
    cuentaRow({ id: PRINCIPAL_ID, slug: "principal", principal: true }),
    cuentaRow({ id: MDP_ID, slug: "mdp", alegraEmail: "mdp@alegra.example", alegraToken: TOKEN_MDP }),
  ],
  sucursales: [
    { slug: "igz", nombre: "Iguazú", cuentaAlegraId: PRINCIPAL_ID },
    { slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: MDP_ID },
  ],
  principalId: PRINCIPAL_ID,
  fila: null,
})

const getDocumentPdf = vi.fn()
const getTenantByIdFromDb = vi.fn()
const cargarContextoCuentaFactura = vi.fn()

vi.mock("@/lib/alegra", () => ({ getDocumentPdf: (...a: unknown[]) => getDocumentPdf(...a) }))
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async () => true,
}))
vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: (...a: unknown[]) => getTenantByIdFromDb(...a) }))
vi.mock("@/lib/pedido-factura-cuenta-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedido-factura-cuenta-repo")>()),
  cargarContextoCuentaFactura: (...a: unknown[]) => cargarContextoCuentaFactura(...a),
}))

const { enviarFacturaPedido } = await import("@/lib/pedido-factura-aviso")

const pedido = (sucursal: "igz" | "mdp") =>
  ({
    id: "33333333-3333-4333-8333-333333333333",
    numero: 123,
    sucursal,
    sucursalRegla: null,
    clienteEmail: "ana@cliente.example",
    contactoNombre: "Ana",
    facturaAlegraId: "7040",
    facturaNumero: "00201-00007040",
  }) as unknown as PedidoRow

const tokenUsado = () => (getDocumentPdf.mock.calls[0]?.[0] as { alegraToken: string } | undefined)?.alegraToken

beforeEach(() => {
  // Sin URL de PDF: el envío termina en "sin_pdf" sin bajar nada de la red.
  getDocumentPdf.mockReset().mockResolvedValue({ clientAlegraId: "55", pdfUrl: null, number: "00201-00007040" })
  getTenantByIdFromDb.mockReset().mockResolvedValue({
    id: TENANT, name: "Tienda Demo", alegraEmail: "principal@alegra.example", alegraToken: TOKEN_PRINCIPAL, alegraMock: false,
  })
  cargarContextoCuentaFactura.mockReset().mockImplementation(async () => contexto())
})

describe("enviarFacturaPedido: cuenta con la que se pide el PDF", () => {
  it("pedido de la sucursal principal → credenciales principales", async () => {
    const r = await enviarFacturaPedido({ tenantId: TENANT, pedido: pedido("igz") })
    expect(r.resultado).toBe("sin_pdf")
    expect(tokenUsado()).toBe(TOKEN_PRINCIPAL)
    expect(getDocumentPdf.mock.calls[0].slice(1)).toEqual(["factura", "7040"])
  })

  // bug conocido: usa la cuenta principal
  it.fails("pedido de MDP → credenciales de MDP", async () => {
    await enviarFacturaPedido({ tenantId: TENANT, pedido: pedido("mdp") })
    expect(tokenUsado()).toBe(TOKEN_MDP)
  })
})
