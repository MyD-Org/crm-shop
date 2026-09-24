import { describe, expect, it } from "vitest"
import { EVENTOS_STOCK } from "./alegra"
import { enmascararUrlStock, esSuscripcionStock, planSuscripcionesStock, rutaWebhookStock } from "./alegra-stock-webhook"

// Plan de suscripciones del script scripts/alegra-webhooks-stock.ts (crear/listar/borrar). Puro:
// no habla con Alegra. URLs de ejemplo con dominios reservados.

const BASE = "https://crm.plataforma.example"
const TOKEN = "a".repeat(32)
const url = (event: (typeof EVENTOS_STOCK)[number], token = TOKEN, base = BASE) => `${base}${rutaWebhookStock("tenant-a", event, token)}`
const sinEsquema = (u: string) => u.replace(/^https:\/\//, "")

describe("planSuscripcionesStock", () => {
  it("sin suscripciones: crea las 9", () => {
    const p = planSuscripcionesStock("tenant-a", BASE, TOKEN, [])
    expect(p.faltan.map((f) => f.event)).toEqual([...EVENTOS_STOCK])
    expect(p.faltan[0].url).toBe(url("new-invoice"))
    expect(p.viejas).toEqual([])
  })

  it("re-ejecución con todo al día (Alegra devuelve la URL sin esquema): no crea nada", () => {
    const actuales = EVENTOS_STOCK.map((event, i) => ({ id: String(i), event, url: sinEsquema(url(event)) }))
    const p = planSuscripcionesStock("tenant-a", BASE, TOKEN, actuales)
    expect(p.faltan).toEqual([])
    expect(p.vigentes).toHaveLength(9)
    expect(p.viejas).toEqual([])
  })

  it("URL con otro token u otro host: desactualizada, y se planea la vigente", () => {
    const actuales = [
      { id: "1", event: "new-invoice", url: sinEsquema(url("new-invoice", "ffffffffffffffffffffffffffffffff")) },
      { id: "2", event: "edit-item", url: sinEsquema(url("edit-item", TOKEN, "https://viejo.plataforma.example")) },
    ]
    const p = planSuscripcionesStock("tenant-a", BASE, TOKEN, actuales)
    expect(p.viejas.map((s) => s.id)).toEqual(["1", "2"])
    expect(p.faltan).toHaveLength(9)
  })

  it("ignora las de contactos y las de otro tenant", () => {
    const actuales = [
      { id: "c", event: "new-client", url: "crm.plataforma.example/api/webhooks/alegra/contactos/tenant-a/new-client/tok" },
      { id: "b", event: "new-invoice", url: "crm.plataforma.example/api/webhooks/alegra/stock/tenant-b/new-invoice/tok" },
    ]
    const p = planSuscripcionesStock("tenant-a", BASE, TOKEN, actuales)
    expect(p.viejas).toEqual([])
    expect(p.faltan).toHaveLength(9)
  })
})

describe("esSuscripcionStock (lo único que `borrar` toca)", () => {
  it("sólo las de stock de este tenant", () => {
    expect(esSuscripcionStock("tenant-a", { id: "1", event: "edit-invoice", url: sinEsquema(url("edit-invoice")) })).toBe(true)
    expect(esSuscripcionStock("tenant-a", { id: "2", event: "edit-client", url: "crm.plataforma.example/api/webhooks/alegra/contactos/tenant-a/edit-client/tok" })).toBe(false)
    // Un evento de stock apuntando a otra ruta tampoco es nuestro.
    expect(esSuscripcionStock("tenant-a", { id: "3", event: "edit-invoice", url: "otro.example/hook" })).toBe(false)
    expect(esSuscripcionStock("tenant-a", { id: "4", event: "edit-invoice", url: "crm.plataforma.example/api/webhooks/alegra/stock/tenant-ab/edit-invoice/tok" })).toBe(false)
  })
})

describe("enmascararUrlStock", () => {
  it("tapa el token", () => {
    const m = enmascararUrlStock(url("new-bill"))
    expect(m).toBe("https://crm.plataforma.example/api/webhooks/alegra/stock/tenant-a/new-bill/aaaa…")
    expect(m).not.toContain(TOKEN)
  })
})
