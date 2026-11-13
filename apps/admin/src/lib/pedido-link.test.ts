import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import vector from "./__fixtures__/pedido-token-vector.json"
import { firmarToken, tokenLinkPago, venceEnLinkPago, TECHO_LINK_PAGO_MS, VIDA_LINK_EN_LINEA_MS } from "./pedido-link"

// El vector es el MISMO del Shop: ata el formato de las dos apps.
afterEach(() => vi.unstubAllEnvs())

const ID = "33333333-3333-4333-8333-333333333333"

describe("firmarToken: compatibilidad con el Shop", () => {
  it("reproduce byte a byte el vector compartido", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", vector.secreto)
    const t = firmarToken({
      proposito: vector.proposito as "compra",
      orderId: vector.orderId,
      venceEn: vector.venceEn,
      tenant: vector.tenant,
    })
    expect(t).toBe(vector.esperado)
  })

  it("el fixture es idéntico al del Shop (si el checkout lo trae)", () => {
    const ruta = join(process.cwd(), "..", "clientes", "src", "lib", "__fixtures__", "pedido-token-vector.json")
    if (!existsSync(ruta)) return
    expect(JSON.parse(readFileSync(ruta, "utf8"))).toEqual(vector)
  })

  it("el propósito cambia la firma (subclave por propósito)", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", vector.secreto)
    const base = { orderId: vector.orderId, venceEn: vector.venceEn, tenant: vector.tenant }
    expect(firmarToken({ ...base, proposito: "pago" })).not.toBe(firmarToken({ ...base, proposito: "compra" }))
  })

  it("el tenant cambia la firma", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", vector.secreto)
    const base = { proposito: "pago" as const, orderId: vector.orderId, venceEn: vector.venceEn }
    expect(firmarToken({ ...base, tenant: "a.example" })).not.toBe(firmarToken({ ...base, tenant: "b.example" }))
  })

  it("el formato es v1.<orderId>.<exp base36>.<firma de 43 caracteres>", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", vector.secreto)
    const t = firmarToken({ proposito: "pago", orderId: ID, venceEn: 1800000000000, tenant: "t.example" })!
    const [v, id, exp, firma] = t.split(".")
    expect([v, id, exp]).toEqual(["v1", ID, (1800000000000).toString(36)])
    expect(firma).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe("falla cerrada", () => {
  it("sin secreto no firma", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "")
    expect(tokenLinkPago({ orderId: ID, tenant: "t.example", creadoEn: 0, reservaVenceEn: null })).toBeNull()
  })
  it("secreto de menos de 32 caracteres no firma", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "corto")
    expect(tokenLinkPago({ orderId: ID, tenant: "t.example", creadoEn: 0, reservaVenceEn: null })).toBeNull()
  })
})

describe("venceEnLinkPago", () => {
  const creadoEn = Date.UTC(2026, 10, 1)
  it("reserva finita: vence con la reserva", () => {
    const reserva = creadoEn + 3 * 3600_000
    expect(venceEnLinkPago({ creadoEn, reservaVenceEn: reserva })).toBe(reserva)
  })
  it("sin reserva (infinity o ausente): 24 h desde la creación", () => {
    expect(venceEnLinkPago({ creadoEn, reservaVenceEn: null })).toBe(creadoEn + VIDA_LINK_EN_LINEA_MS)
  })
  it("reserva más larga que 30 días: tope de 30 días", () => {
    expect(venceEnLinkPago({ creadoEn, reservaVenceEn: creadoEn + 90 * 86_400_000 })).toBe(creadoEn + TECHO_LINK_PAGO_MS)
  })
  it("el token usa ese vencimiento", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", vector.secreto)
    const t = tokenLinkPago({ orderId: ID, tenant: "t.example", creadoEn, reservaVenceEn: null })!
    expect(parseInt(t.split(".")[2], 36)).toBe(creadoEn + VIDA_LINK_EN_LINEA_MS)
  })
})
