import { describe, expect, it } from "vitest"
import { partirIdDeCola } from "./alegra-stock-cuenta"
import {
  enmascararUrlStockCuenta,
  esSuscripcionStock,
  esSuscripcionStockCuenta,
  planSuscripcionesStock,
  planSuscripcionesStockCuenta,
  rutaWebhookStockCuenta,
  tokenWebhookStock,
  tokenWebhookStockCuenta,
  tokenWebhookStockCuentaValido,
} from "./alegra-stock-webhook"
import { tokenValido, tokenWebhook } from "./alegra-webhook-comun"

const SECRETO = "s".repeat(40)
const CUENTA_A = "11111111-1111-4111-8111-111111111111"
const CUENTA_B = "22222222-2222-4222-8222-222222222222"

describe("partirIdDeCola", () => {
  it("separa el slug del id en la cuenta", () => {
    expect(partirIdDeCola("mdp:1234")).toEqual({ slug: "mdp", idEnCuenta: "1234" })
  })
  it("un id numérico de la principal no tiene prefijo", () => {
    expect(partirIdDeCola("1234")).toBeNull()
    expect(partirIdDeCola(":1234")).toBeNull()
    expect(partirIdDeCola("mdp:")).toBeNull()
  })
})

describe("token y URL de stock de una cuenta secundaria", () => {
  it("el token es de la cuenta: válido para ella, inválido para otra, vacío o sin secreto", () => {
    const t = tokenWebhookStockCuenta(CUENTA_A, SECRETO)!
    expect(t).toMatch(/^[0-9a-f]{32}$/)
    expect(tokenWebhookStockCuentaValido(CUENTA_A, t, SECRETO)).toBe(true)
    expect(tokenWebhookStockCuentaValido(CUENTA_B, t, SECRETO)).toBe(false)
    expect(tokenWebhookStockCuentaValido(CUENTA_A, "", SECRETO)).toBe(false)
    expect(tokenWebhookStockCuentaValido(CUENTA_A, t, undefined)).toBe(false)
    expect(tokenWebhookStockCuenta(CUENTA_A, "corto")).toBeNull()
  })
  it("no se reutiliza el token de la principal: distinto dominio", () => {
    const deCuenta = tokenWebhookStockCuenta(CUENTA_A, SECRETO)!
    const deTenant = tokenWebhookStock(CUENTA_A, SECRETO)!
    expect(deCuenta).not.toBe(deTenant)
    expect(tokenValido("alegra-stock", CUENTA_A, deCuenta, SECRETO)).toBe(false)
    expect(tokenValido("alegra-stock-cuenta", CUENTA_A, deTenant, SECRETO)).toBe(false)
    expect(tokenWebhook("alegra-stock-cuenta", CUENTA_A, SECRETO)).toBe(deCuenta)
  })
  it("las suscripciones de una cuenta no se confunden con las de la principal ni con las de otra cuenta", () => {
    const t = tokenWebhookStockCuenta(CUENTA_A, SECRETO)!
    const url = `https://crm.example${rutaWebhookStockCuenta(CUENTA_A, "new-invoice", t)}`
    const s = { id: "1", event: "new-invoice", url }
    expect(esSuscripcionStockCuenta(CUENTA_A, s)).toBe(true)
    expect(esSuscripcionStockCuenta(CUENTA_B, s)).toBe(false)
    expect(esSuscripcionStock("tenant-a", s)).toBe(false)
    expect(esSuscripcionStockCuenta(CUENTA_A, { id: "2", event: "new-invoice", url: "https://crm.example/api/webhooks/alegra/stock/tenant-a/new-invoice/x" })).toBe(false)
  })
  it("el plan crea las nueve y detecta las vigentes y las viejas", () => {
    const t = tokenWebhookStockCuenta(CUENTA_A, SECRETO)!
    const vacio = planSuscripcionesStockCuenta(CUENTA_A, "https://crm.example", t, [])
    expect(vacio.faltan).toHaveLength(9)
    const vigente = { id: "1", event: "new-invoice", url: `crm.example${rutaWebhookStockCuenta(CUENTA_A, "new-invoice", t)}` }
    const vieja = { id: "2", event: "edit-invoice", url: `crm.example${rutaWebhookStockCuenta(CUENTA_A, "edit-invoice", "0".repeat(32))}` }
    const plan = planSuscripcionesStockCuenta(CUENTA_A, "https://crm.example", t, [vigente, vieja])
    expect(plan.vigentes).toEqual(["new-invoice"])
    expect(plan.viejas.map((v) => v.id)).toEqual(["2"])
    expect(plan.faltan).toHaveLength(8)
    // El plan de la principal no ve las suscripciones de la cuenta.
    expect(planSuscripcionesStock("tenant-a", "https://crm.example", "tok", [vigente]).viejas).toEqual([])
  })
  it("enmascara el token en pantalla", () => {
    const url = `https://crm.example${rutaWebhookStockCuenta(CUENTA_A, "new-item", "abcdef0123456789abcdef0123456789")}`
    expect(enmascararUrlStockCuenta(url)).toContain("/new-item/abcd…")
    expect(enmascararUrlStockCuenta(url)).not.toContain("abcdef0123456789")
  })
})
