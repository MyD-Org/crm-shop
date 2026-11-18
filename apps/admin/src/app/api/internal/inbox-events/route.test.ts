import { describe, it, expect, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  tenant: [{ id: "tenant-a" }] as Record<string, unknown>[],
  superadminCalls: [] as unknown[][],
  operatorCalls: [] as unknown[][],
  departmentCalls: [] as unknown[][],
  resueltas: [] as string[],
}))

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.tenant) }),
    }),
  }),
}))
vi.mock("@/lib/secure-compare", () => ({ bearerMatches: (h: string | null) => h === "Bearer ok" }))
vi.mock("@/lib/push", () => ({
  sendPushToSuperadmins: async (...a: unknown[]) => { state.superadminCalls.push(a); return 2 },
  sendPushToOperatorConAcceso: async (...a: unknown[]) => { state.operatorCalls.push(a); return 1 },
  sendPushToDepartment: async (...a: unknown[]) => { state.departmentCalls.push(a); return 1 },
  canalDelEvento: (r: () => Promise<string | null>) => r,
}))
vi.mock("@/lib/canal-acceso-conversacion", () => ({
  cuentaDeConversacion: async (_t: unknown, id: string) => { state.resueltas.push(id); return "canal-resuelto" },
}))

async function post(body: unknown, auth = "Bearer ok") {
  const { POST } = await import("./route")
  return POST(new Request("http://crm.example/api/internal/inbox-events", {
    method: "POST",
    headers: { authorization: auth },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  state.tenant = [{ id: "tenant-a" }]
  state.superadminCalls = []
  state.operatorCalls = []
  state.departmentCalls = []
  state.resueltas = []
})

const billing = { tenantId: "ai-a", event: "wa_billing", kind: "free_80", month: "2026-10", phone: "+54 11 0000-0000", volume: 800, limit: 1000 }

describe("inbox-events wa_billing", () => {
  it("manda push sólo a superadmins, sin conversationId, en usted", async () => {
    const res = await post(billing)
    expect(res.status).toBe(200)
    expect(state.superadminCalls).toHaveLength(1)
    expect(state.operatorCalls).toHaveLength(0)
    expect(state.departmentCalls).toHaveLength(0)
    const [tenantId, payload] = state.superadminCalls[0] as [string, { body: string; url: string }]
    expect(tenantId).toBe("tenant-a")
    expect(payload.body).toBe("Mensajes de WhatsApp: +54 11 0000-0000 llegó a 800 de 1.000 gratis de este mes.")
    expect(payload.url).toBe("/admin/uso")
  })

  it("service_billed", async () => {
    await post({ ...billing, kind: "service_billed", volume: 1000 })
    const [, payload] = state.superadminCalls[0] as [string, { body: string }]
    expect(payload.body).toBe("WhatsApp empezó a cobrar las respuestas de +54 11 0000-0000 este mes.")
  })

  it("kind inválido o campos faltantes -> 400", async () => {
    expect((await post({ ...billing, kind: "otro" })).status).toBe(400)
    expect((await post({ ...billing, phone: undefined })).status).toBe(400)
    expect((await post({ ...billing, volume: "800" })).status).toBe(400)
    expect(state.superadminCalls).toHaveLength(0)
  })

  it("tenant desconocido -> 200 sin enviar", async () => {
    state.tenant = []
    const res = await post(billing)
    expect(res.status).toBe(200)
    expect(state.superadminCalls).toHaveLength(0)
  })

  it("sin autorización -> 401", async () => {
    expect((await post(billing, "Bearer mal")).status).toBe(401)
  })
})

describe("inbox-events: eventos existentes intactos", () => {
  it("handoff y inbound siguen exigiendo conversationId", async () => {
    expect((await post({ tenantId: "ai-a", event: "handoff" })).status).toBe(400)
    expect((await post({ tenantId: "ai-a", event: "inbound" })).status).toBe(400)
  })
  it("handoff con conversationId notifica al departamento", async () => {
    const res = await post({ tenantId: "ai-a", event: "handoff", conversationId: "c1", department: "ventas" })
    expect(res.status).toBe(200)
    expect(state.departmentCalls).toHaveLength(1)
    expect(state.superadminCalls).toHaveLength(0)
  })
  it("evento desconocido -> 400", async () => {
    expect((await post({ tenantId: "ai-a", event: "x", conversationId: "c1" })).status).toBe(400)
  })
})

describe("inbox-events: canal del evento (acceso por canal)", () => {
  type Canal = () => Promise<string | null>
  it("payload nuevo (S2): el canal sale del evento, sin consultar ai-api", async () => {
    state.tenant = [{ id: "tenant-a", aiApiUrl: "http://ai.test", aiTenantId: "ai-a" }]
    await post({ tenantId: "ai-a", event: "handoff", conversationId: "c1", department: "ventas", channel: "whatsapp", channelAccountId: "canal-a" })
    const canal = state.departmentCalls[0][3] as Canal
    expect(await canal()).toBe("canal-a")
    expect(state.resueltas).toEqual([])
  })
  it("canal sin cuenta: clave canal:<canal>", async () => {
    await post({ tenantId: "ai-a", event: "inbound", conversationId: "c1", operatorId: "op-1", channel: "instagram", channelAccountId: null })
    const canal = state.operatorCalls[0][3] as Canal
    expect(await canal()).toBe("canal:instagram")
  })
  it("payload viejo (sin channel): el CRM resuelve la conversación contra ai-api", async () => {
    state.tenant = [{ id: "tenant-a", aiApiUrl: "http://ai.test", aiTenantId: "ai-a" }]
    await post({ tenantId: "ai-a", event: "handoff", conversationId: "c9", operatorId: "op-1" })
    const canal = state.operatorCalls[0][3] as Canal
    expect(await canal()).toBe("canal-resuelto")
    expect(state.resueltas).toEqual(["c9"])
  })
  it("payload viejo y tenant sin ai-api: canal desconocido (null)", async () => {
    await post({ tenantId: "ai-a", event: "handoff", conversationId: "c9", department: "ventas" })
    const canal = state.departmentCalls[0][3] as Canal
    expect(await canal()).toBeNull()
  })
})
