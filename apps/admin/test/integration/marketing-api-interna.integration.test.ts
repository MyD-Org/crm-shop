// test/integration/marketing-api-interna.integration.test.ts
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { seedTenant, truncateAll } from "./helpers"

const T = "tenant-mkt"
const SECRETOS = { studio: "s-studio", planificador: "s-planner", aiapi: "s-aiapi" }
const fetchMock = vi.fn(async () => Response.json({ ok: true }))

const piezas = await import("@/app/api/internal/marketing/piezas/route")
const pieza = await import("@/app/api/internal/marketing/piezas/[id]/route")
const claim = await import("@/app/api/internal/marketing/piezas/[id]/claim/route")

function req(path: string, secreto: string | null, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://crm.cliente.example/api/internal/marketing${path}`, {
    method: init.method ?? "GET",
    headers: { ...(secreto ? { authorization: `Bearer ${secreto}` } : {}), "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const nueva = { canal: "instagram", formato: "reel", plantilla: "producto-destacado", publico: "ambos", tema: "producto", objetivo: "alcance", produccion: "auto", caption: "Hola", programadaPara: "2026-10-13T22:00:00.000Z" }

describe("API interna de marketing: piezas", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    vi.stubEnv("MARKETING_TENANT_ID", T)
    vi.stubEnv("MARKETING_STUDIO_SECRET", SECRETOS.studio)
    vi.stubEnv("MARKETING_PLANNER_SECRET", SECRETOS.planificador)
    vi.stubEnv("MARKETING_AIAPI_SECRET", SECRETOS.aiapi)
    vi.stubEnv("MARKETING_STUDIO_URL", "http://studio.test")
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockClear()
  })

  it("401 sin secreto o con uno desconocido", async () => {
    expect((await piezas.GET(req("/piezas", null))).status).toBe(401)
    expect((await piezas.GET(req("/piezas", "otro"))).status).toBe(401)
  })

  it("403 si el studio intenta crear piezas", async () => {
    const r = await piezas.POST(req("/piezas", SECRETOS.studio, { method: "POST", body: nueva }))
    expect(r.status).toBe(403)
  })

  it("la rutina crea una pieza, el CRM avisa al studio y responde no-store", async () => {
    const r = await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: nueva }))
    expect(r.status).toBe(201)
    expect(r.headers.get("cache-control")).toBe("no-store")
    const p = await r.json()
    expect(p).toMatchObject({ estado: "borrador", origen: "planificador", caption: "Hola" })
    expect(fetchMock).toHaveBeenCalledWith("http://studio.test/ping", expect.objectContaining({ method: "POST" }))
  })

  it("400 con un valor fuera de los permitidos", async () => {
    const r = await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: { ...nueva, publico: "todos" } }))
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: "invalid_publico" })
  })

  it("403 si la rutina intenta reclamar", async () => {
    const p = await (await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: nueva }))).json()
    expect((await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.planificador, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))).status).toBe(403)
  })

  it("flujo del studio: claim (200, luego 409) y PATCH a para_revisar", async () => {
    const p = await (await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: nueva }))).json()
    const c1 = await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
    expect(c1.status).toBe(200)
    const c2 = await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w2", ttlSeg: 600 } }), ctx(p.id))
    expect(c2.status).toBe(409)
    const r = await pieza.PATCH(req(`/piezas/${p.id}`, SECRETOS.studio, { method: "PATCH", body: { estado: "para_revisar", worker: "w1", renderKey: `marketing/${T}/render/a.mp4` } }), ctx(p.id))
    expect(r.status).toBe(200)
    expect((await r.json()).estado).toBe("para_revisar")
  })

  it("409 si el PATCH pide una transición que el cliente no tiene", async () => {
    const p = await (await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: nueva }))).json()
    const r = await pieza.PATCH(req(`/piezas/${p.id}`, SECRETOS.aiapi, { method: "PATCH", body: { estado: "publicada" } }), ctx(p.id))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: "invalid_transition" })
  })

  it("404 para una pieza inexistente o un id que no es uuid", async () => {
    expect((await pieza.GET(req("/piezas/no-es-uuid", SECRETOS.studio), ctx("no-es-uuid"))).status).toBe(404)
  })

  it("GET lista por estado y libera claims vencidos antes de listar", async () => {
    await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: nueva }))
    const r = await piezas.GET(req("/piezas?estado=borrador", SECRETOS.studio))
    expect(r.status).toBe(200)
    expect((await r.json()).items).toHaveLength(1)
  })
})
