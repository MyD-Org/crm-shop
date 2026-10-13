import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * /api/admin/whatsapp-onboarding: el tenant del link sale SIEMPRE de la sesión. Un superadmin no
 * puede emitir un enlace de alta para otra empresa. La DB y ai-api se simulan.
 */

const state = vi.hoisted(() => ({
  guarded: {} as Record<string, unknown>,
  tenant: {} as Record<string, unknown>,
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => [state.tenant] }) }) }),
}))

const SECRET = "secreto-interno-ficticio"
const fetchMock = vi.fn()

const sesion = (role: string) => ({
  ok: true,
  tenantId: "tenant-a",
  user: { id: "u1", name: "Ana", email: "ana@cliente.example", role },
})

const req = (body?: unknown) =>
  new Request("http://admin.test/api/admin/whatsapp-onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = sesion("superadmin")
  state.tenant = { aiApiUrl: "https://ai-api.example/", aiTenantId: "propio-ai" }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ url: "https://enlace.example/x" }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("INTERNAL_SECRET", SECRET)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("/api/admin/whatsapp-onboarding", () => {
  it("body.tenantId de otra empresa → 403 en usted y sin llamar a ai-api", async () => {
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const res = (await POST(req({ metaAppSlug: "app-1", tenantId: "otro-ai" }) as never))!
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "No puede emitir enlaces para otra empresa." })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin body.tenantId → usa el tenant de la sesión", async () => {
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const res = (await POST(req({ metaAppSlug: "app-1" }) as never))!
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://ai-api.example/onboarding/whatsapp/links")
    expect(JSON.parse(init.body)).toEqual({ tenantId: "propio-ai", metaAppSlug: "app-1" })
  })

  it("body.tenantId igual al propio → funciona", async () => {
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const res = (await POST(req({ metaAppSlug: "app-1", tenantId: "propio-ai" }) as never))!
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tenantId).toBe("propio-ai")
  })

  it("aiTenantId vacío → 400 y sin llamar a ai-api", async () => {
    state.tenant = { aiApiUrl: "https://ai-api.example", aiTenantId: null }
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const res = (await POST(req({ metaAppSlug: "app-1" }) as never))!
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falta metaAppSlug → 400", async () => {
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const res = (await POST(req({}) as never))!
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(["admin", "operator"])("rol %s → 404 uniforme y sin llamar a ai-api", async (rol) => {
    state.guarded = sesion(rol)
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const res = (await POST(req({ metaAppSlug: "app-1" }) as never))!
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("la respuesta nunca contiene INTERNAL_SECRET", async () => {
    const { POST } = await import("@/app/api/admin/whatsapp-onboarding/route")
    const ok = (await POST(req({ metaAppSlug: "app-1" }) as never))!
    const prohibido = (await POST(req({ metaAppSlug: "app-1", tenantId: "otro-ai" }) as never))!
    expect(await ok.text()).not.toContain(SECRET)
    expect(await prohibido.text()).not.toContain(SECRET)
  })
})
