import { afterEach, describe, expect, it, vi } from "vitest"
import { createWebhookSubscription, urlSinEsquema } from "./alegra"
import type { TenantConfig } from "./tenants"

// Alegra rechaza la URL de una suscripción con esquema: 400 "La URL ingresada no debe incluir
// el http:// o https://". Se registra host/ruta.

const tenant = { id: "t", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

afterEach(() => vi.unstubAllGlobals())

describe("urlSinEsquema", () => {
  it("saca https:// y http://, y deja el resto igual", () => {
    expect(urlSinEsquema("https://crm.plataforma.example/api/webhooks/x")).toBe("crm.plataforma.example/api/webhooks/x")
    expect(urlSinEsquema("HTTP://crm.plataforma.example/a")).toBe("crm.plataforma.example/a")
    expect(urlSinEsquema("crm.plataforma.example/a")).toBe("crm.plataforma.example/a")
  })
})

describe("createWebhookSubscription", () => {
  it("manda la URL sin esquema en el body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", event: "new-client", url: "x" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    await createWebhookSubscription(tenant, "new-client", "https://crm.plataforma.example/api/webhooks/alegra/contactos/t/new-client/tok")
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      event: "new-client",
      url: "crm.plataforma.example/api/webhooks/alegra/contactos/t/new-client/tok",
    })
  })
})
