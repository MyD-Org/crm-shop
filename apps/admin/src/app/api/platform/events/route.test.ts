import { describe, it, expect, vi } from "vitest"
import { createHmac } from "node:crypto"

const estado = vi.hoisted(() => ({ secret: "ab".repeat(32), procesar: vi.fn(async () => "procesado" as const), aviso: vi.fn(async () => ({ propagado: true })) }))
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock("@/lib/tenant-context", () => ({ resolveRequestTenantId: async () => "central-led" }))
vi.mock("@/lib/tenants", () => ({ getTenantByIdFromDb: async () => ({ id: "central-led", plataformaWebhookSecret: estado.secret }) }))
vi.mock("@/lib/plataforma-receptor", async (orig) => ({ ...(await orig<typeof import("@/lib/plataforma-receptor")>()), procesarEvento: estado.procesar }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: estado.aviso }))

import { POST } from "./route"

const secret = "ab".repeat(32)
const pedir = (body: string, firma?: string, delivery = "d1") => new Request("https://central-led.crm.example/api/platform/events", {
  method: "POST", body,
  headers: { "content-type": "application/json", ...(firma ? { "x-platform-signature-256": firma } : {}), "x-platform-event": "atributos_tecnicos:update", "x-platform-delivery": delivery },
})
const firmar = (body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
const body = JSON.stringify({ id: "e1", action: "atributos_tecnicos:update", payload: { instance: { external_key: "42", data: {}, updated_at: "2026-10-15T12:00:00Z", id: "i", spec: "atributos_tecnicos", spec_version: 1, anchors: {} } } })

describe("POST /api/platform/events", () => {
  it("entrega repetida → 200 'repetido' y no avisa al Shop", async () => {
    estado.aviso.mockClear()
    estado.procesar.mockResolvedValueOnce("repetido" as never)
    const r = await POST(pedir(body, firmar(body)))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ resultado: "repetido" })
    expect(estado.aviso).not.toHaveBeenCalled()
  })
  it("tenant con secret vacío → 401", async () => {
    estado.secret = ""
    try { expect((await POST(pedir(body, firmar(body)))).status).toBe(401) } finally { estado.secret = "ab".repeat(32) }
  })
  it("firma válida → 200 y avisa al Shop; firma inválida → 401 sin procesar", async () => {
    estado.procesar.mockClear()
    const ok = await POST(pedir(body, firmar(body)))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ resultado: "procesado" })
    expect(estado.aviso).toHaveBeenCalledWith("central-led")
    const mal = await POST(pedir(body, "sha256=00"))
    expect(mal.status).toBe(401)
    expect(estado.procesar).toHaveBeenCalledTimes(1)
  })
  it("body que no es JSON → 400; sin X-Platform-Delivery → 400", async () => {
    expect((await POST(pedir("{no", firmar("{no")))).status).toBe(400)
    const sinDelivery = new Request("https://central-led.crm.example/api/platform/events", { method: "POST", body, headers: { "x-platform-signature-256": firmar(body) } })
    expect((await POST(sinDelivery)).status).toBe(400)
  })
})
