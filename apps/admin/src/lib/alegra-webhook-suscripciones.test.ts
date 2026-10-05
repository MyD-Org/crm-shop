import { afterEach, describe, expect, it, vi } from "vitest"
import { listWebhookSubscriptions } from "./alegra"
import type { TenantConfig } from "./tenants"

// GET /webhooks/subscriptions: Alegra envuelve la lista distinto según la cuenta. Fetch falso:
// nada sale a la red. URLs inventadas.

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig
const sub = { id: 7, event: "edit-item", url: "crm.plataforma.example/api/webhooks/alegra/stock/t/edit-item/tok" }
const esperado = [{ id: "7", event: "edit-item", url: sub.url }]

function responde(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("listWebhookSubscriptions", () => {
  it("lista suelta", async () => {
    responde([sub])
    expect(await listWebhookSubscriptions(tenant)).toEqual(esperado)
  })

  it("{ data: [...] }", async () => {
    responde({ data: [sub] })
    expect(await listWebhookSubscriptions(tenant)).toEqual(esperado)
  })

  it("{ subscriptions: [...] } (la forma que devuelve la cuenta real)", async () => {
    responde({ subscriptions: [sub] })
    expect(await listWebhookSubscriptions(tenant)).toEqual(esperado)
  })

  it("{ subscriptions: null } (cuenta sin suscripciones) → [] sin aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    responde({ subscriptions: null })
    expect(await listWebhookSubscriptions(tenant)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it("forma desconocida → [] y avisa con las claves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    responde({ otra: 1 })
    expect(await listWebhookSubscriptions(tenant)).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("claves: otra: number"))
  })
})
