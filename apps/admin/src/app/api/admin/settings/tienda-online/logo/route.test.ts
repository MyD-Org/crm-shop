import { beforeEach, describe, expect, it, vi } from "vitest"

/** POST /api/admin/settings/tienda-online/logo: firma la subida de una imagen de marca a `marca/{tenant}/`. */

const state = vi.hoisted(() => ({
  session: { userId: "u1", role: "admin", tenantId: "tenant-a" } as Record<string, unknown>,
  r2: null as null | { presignPut: ReturnType<typeof vi.fn> },
}))

vi.mock("@/lib/admin-route-guard", () => ({
  requireAdminPlus: async () => {
    const s = state.session
    if (!s.userId) return { ok: false, response: Response.json({ error: "No autorizado" }, { status: 401 }) }
    if (s.role === "operator") return { ok: false, response: Response.json({ error: "No encontrado" }, { status: 404 }) }
    return { ok: true, tenantId: s.tenantId }
  },
}))
vi.mock("@/lib/shop-media", async () => {
  const real = await vi.importActual<typeof import("@/lib/shop-media")>("@/lib/shop-media")
  return { ...real, getShopMediaR2: () => state.r2 }
})

const req = (body?: unknown) =>
  new Request("http://admin.test/api/admin/settings/tienda-online/logo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.session = { userId: "u1", role: "admin", tenantId: "tenant-a" }
  state.r2 = {
    presignPut: vi.fn(async (key: string, o: { contentType: string }) => ({
      url: `https://r2.example/${key}?firma`,
      headers: { "content-type": o.contentType },
      expiresAt: new Date(),
    })),
  }
  vi.stubEnv("R2_SHOP_MEDIA_PUBLIC_URL", "https://media.example/")
})

describe("POST /api/admin/settings/tienda-online/logo", () => {
  it("sin sesión → 401; operator → 404 y no firma", async () => {
    const { POST } = await import("./route")
    state.session = {}
    expect((await POST(req({ ext: "png", bytes: 10 }))).status).toBe(401)
    state.session = { userId: "u1", role: "operator", tenantId: "tenant-a" }
    expect((await POST(req({ ext: "png", bytes: 10 }))).status).toBe(404)
    expect(state.r2!.presignPut).not.toHaveBeenCalled()
  })

  it("firma la subida bajo marca/{tenant del guard}/ con el content-type de la extensión", async () => {
    const { POST } = await import("./route")
    const res = await POST(req({ ext: "svg", bytes: 1234, tenantId: "otro" }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.key).toMatch(/^marca\/tenant-a\/[0-9a-f-]{36}\.svg$/)
    expect(j.publicUrl).toBe(`https://media.example/${j.key}`)
    expect(j.headers).toEqual({ "content-type": "image/svg+xml" })
    expect(state.r2!.presignPut).toHaveBeenCalledWith(j.key, expect.objectContaining({ contentType: "image/svg+xml", contentLength: 1234 }))
  })

  it.each([
    [{ ext: "gif", bytes: 10 }],
    [{ ext: "png", bytes: 0 }],
    [{ ext: "png", bytes: 3 * 1024 * 1024 }],
    [{ ext: "png", bytes: 1.5 }],
    [{ bytes: 10 }],
    [null],
  ])("cuerpo inválido %j → 400 en usted, sin firmar", async (cuerpo) => {
    const { POST } = await import("./route")
    const res = await POST(req(cuerpo ?? undefined))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/imagen|archivo|formato|tamaño/i)
    expect(state.r2!.presignPut).not.toHaveBeenCalled()
  })

  it("sin almacenamiento configurado → 503", async () => {
    const { POST } = await import("./route")
    state.r2 = null
    const res = await POST(req({ ext: "png", bytes: 10 }))
    expect(res.status).toBe(503)
  })
})
