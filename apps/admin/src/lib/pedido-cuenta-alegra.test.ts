import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PedidoRow } from "@/lib/pedidos-repo"

// La cuenta de Alegra de un pedido para vincular/reenviar/remito: la de la sucursal (o la de la
// factura emitida), nunca la principal por defecto. Repo y tenant simulados; datos inventados.

const getTenantByIdFromDb = vi.fn()
const cargarContexto = vi.fn()

vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: (...a: unknown[]) => getTenantByIdFromDb(...a) }))
vi.mock("@/lib/pedido-factura-cuenta-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedido-factura-cuenta-repo")>()),
  cargarContextoCuentaFactura: (...a: unknown[]) => cargarContexto(...a),
}))

const { configAlegraDelPedido } = await import("@/lib/pedido-cuenta-alegra")

const base = { id: "tenant-a", name: "Tienda", alegraEmail: "principal@cliente.example", alegraToken: "t-principal", alegraMock: false }
const cuenta = (over: Record<string, unknown>) => ({
  tenantId: "tenant-a", activa: true, alegraMock: false, alegraEmail: null, alegraToken: null, ...over,
})
const principal = cuenta({ id: "c-p", slug: "principal", nombre: "Principal", principal: true })
const mdp = cuenta({ id: "c-m", slug: "mdp", nombre: "MDP", principal: false, alegraEmail: "mdp@cliente.example", alegraToken: "t-mdp" })
const pedido = (sucursal: string | null) => ({ id: "p1", sucursal, sucursalRegla: null }) as unknown as PedidoRow

const ctx = (over: Record<string, unknown> = {}) => ({
  cuentas: [principal, mdp],
  sucursales: [
    { slug: "igz", nombre: "Iguazú", cuentaAlegraId: "c-p" },
    { slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: "c-m" },
  ],
  principalId: "c-p",
  fila: null,
  ...over,
})

beforeEach(() => {
  getTenantByIdFromDb.mockReset().mockResolvedValue(base)
  cargarContexto.mockReset().mockResolvedValue(ctx())
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("configAlegraDelPedido", () => {
  it("pedido de una sucursal con cuenta propia usa las credenciales de esa cuenta", async () => {
    const r = await configAlegraDelPedido("tenant-a", pedido("mdp"))
    expect(r).toMatchObject({ ok: true, cuentaSlug: "mdp" })
    if (r.ok) expect(r.config).toMatchObject({ alegraEmail: "mdp@cliente.example", alegraToken: "t-mdp" })
  })

  it("pedido de la sucursal con la cuenta principal usa la config base", async () => {
    const r = await configAlegraDelPedido("tenant-a", pedido("igz"))
    expect(r).toMatchObject({ ok: true, cuentaSlug: "principal" })
    if (r.ok) expect(r.config.alegraToken).toBe("t-principal")
  })

  it("si la factura se emitió en otra cuenta, manda esa", async () => {
    cargarContexto.mockResolvedValue(ctx({ fila: { facturaCuentaId: "c-m", cuentaOverrideId: null } }))
    const r = await configAlegraDelPedido("tenant-a", pedido("igz"))
    expect(r).toMatchObject({ ok: true, cuentaSlug: "mdp" })
  })

  it("cuenta de sucursal sin credenciales: error en usted, no cae a la principal", async () => {
    cargarContexto.mockResolvedValue(ctx({ cuentas: [principal, { ...mdp, alegraEmail: null, alegraToken: null }] }))
    const r = await configAlegraDelPedido("tenant-a", pedido("mdp"))
    expect(r).toMatchObject({ ok: false, status: 422, code: "cuenta_sin_credenciales" })
  })

  it("sucursal sin cuenta asignada: sin_cuenta", async () => {
    cargarContexto.mockResolvedValue(ctx({ sucursales: [{ slug: "mdp", nombre: "MDP", cuentaAlegraId: null }] }))
    const r = await configAlegraDelPedido("tenant-a", pedido("mdp"))
    expect(r).toMatchObject({ ok: false, status: 422, code: "sin_cuenta" })
  })

  it("tenant inexistente: 500", async () => {
    getTenantByIdFromDb.mockResolvedValue(null)
    expect(await configAlegraDelPedido("tenant-a", pedido("mdp"))).toMatchObject({ ok: false, status: 500 })
  })
})
