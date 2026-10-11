// Subida de material del equipo: POST firma la URL PUT a R2, PUT confirma y registra. DB real
// (crm_test) y guard real; sólo se simula la sesión y se stubean las env del bucket (la firma es local).
import { NextRequest } from "next/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { resetShopMediaR2 } from "@/lib/shop-media"
import { seedOperator, seedTenant, truncateAll } from "./helpers"
import { crearPieza, obtenerPieza, transicionar } from "@/lib/marketing/piezas-repo"

let session: Record<string, unknown> = {}
vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-mkt" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const T = "tenant-mkt"
const material = await import("@/app/api/admin/marketing/piezas/[id]/material/route")
const semi = { canal: "instagram", formato: "reel", plantilla: "clip-propio", publico: "ambos", tema: "marca_comunidad", objetivo: "local", produccion: "semi" } as const

function login(userId: string) {
  session = { userId, role: "admin", tenantId: T, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
}

function req(id: string, body: unknown, method: "POST" | "PUT") {
  return new NextRequest(`http://${T}.localhost/api/admin/marketing/piezas/${id}/material`, {
    method,
    headers: { host: `${T}.localhost`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const nuevaPieza = () => crearPieza(T, semi, { tipo: "planificador", nombre: "rutina" })

describe("subida de material", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    invalidateTenantRegistry()
    login(await seedOperator(T, { role: "admin" }))
    vi.stubEnv("R2_SHOP_MEDIA_ACCOUNT_ID", "cuenta")
    vi.stubEnv("R2_SHOP_MEDIA_ACCESS_KEY_ID", "ak")
    vi.stubEnv("R2_SHOP_MEDIA_SECRET_ACCESS_KEY", "sk")
    vi.stubEnv("R2_SHOP_MEDIA_BUCKET", "bucket")
    vi.stubEnv("R2_SHOP_MEDIA_PUBLIC_URL", "https://media.cliente.example")
    resetShopMediaR2()
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    resetShopMediaR2()
    await truncateAll()
  })

  it("400 para un tipo no permitido o un archivo demasiado grande", async () => {
    const p = await nuevaPieza()
    expect((await material.POST(req(p.id, { contentType: "application/pdf", bytes: 10 }, "POST"), ctx(p.id))).status).toBe(400)
    expect((await material.POST(req(p.id, { contentType: "video/mp4", bytes: 400 * 1024 * 1024 }, "POST"), ctx(p.id))).status).toBe(400)
  })

  it("firma la subida y al confirmar la pieza pasa a borrador", async () => {
    const p = await nuevaPieza()
    const firmado = await (await material.POST(req(p.id, { contentType: "video/mp4", bytes: 5_000_000 }, "POST"), ctx(p.id))).json()
    expect(firmado.key).toMatch(new RegExp(`^marketing/${T}/material/${p.id}/[0-9a-f-]+\\.mp4$`))
    expect(firmado.url).toContain("X-Amz-Signature")
    const r = await material.PUT(req(p.id, { key: firmado.key, contentType: "video/mp4", bytes: 5_000_000 }, "PUT"), ctx(p.id))
    expect(r.status).toBe(201)
    expect((await obtenerPieza(T, p.id))!.estado).toBe("borrador")
  })

  it("400 si la key confirmada no es de esta pieza", async () => {
    const p = await nuevaPieza()
    const r = await material.PUT(req(p.id, { key: `marketing/otro/material/${p.id}/x.mp4`, contentType: "video/mp4", bytes: 10 }, "PUT"), ctx(p.id))
    expect(r.status).toBe(400)
  })

  it("409 si la key ya fue registrada", async () => {
    const p = await nuevaPieza()
    const { key } = await (await material.POST(req(p.id, { contentType: "image/png", bytes: 1000 }, "POST"), ctx(p.id))).json()
    const cuerpo = { key, contentType: "image/png", bytes: 1000 }
    expect((await material.PUT(req(p.id, cuerpo, "PUT"), ctx(p.id))).status).toBe(201)
    const r = await material.PUT(req(p.id, cuerpo, "PUT"), ctx(p.id))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: "Este archivo ya fue registrado", code: "duplicate" })
  })

  it("409 si la pieza ya no admite material (POST y PUT)", async () => {
    const p = await nuevaPieza()
    const { key } = await (await material.POST(req(p.id, { contentType: "video/mp4", bytes: 1000 }, "POST"), ctx(p.id))).json()
    expect((await transicionar(T, p.id, "descartada", "usuario", { nombreActor: "Ana" })).ok).toBe(true)
    const esperado = { error: "Esta pieza ya no admite material", code: "invalid_state" }
    const post = await material.POST(req(p.id, { contentType: "video/mp4", bytes: 1000 }, "POST"), ctx(p.id))
    expect(post.status).toBe(409)
    expect(await post.json()).toEqual(esperado)
    const put = await material.PUT(req(p.id, { key, contentType: "video/mp4", bytes: 1000 }, "PUT"), ctx(p.id))
    expect(put.status).toBe(409)
    expect(await put.json()).toEqual(esperado)
  })

  it("404 para una pieza inexistente", async () => {
    const id = "00000000-0000-4000-8000-000000000000"
    expect((await material.POST(req(id, { contentType: "video/mp4", bytes: 10 }, "POST"), ctx(id))).status).toBe(404)
  })

  it("503 si el almacenamiento no está configurado", async () => {
    const p = await nuevaPieza()
    vi.stubEnv("R2_SHOP_MEDIA_PUBLIC_URL", "")
    resetShopMediaR2()
    const r = await material.POST(req(p.id, { contentType: "video/mp4", bytes: 10 }, "POST"), ctx(p.id))
    expect(r.status).toBe(503)
    expect((await r.json()).code).toBe("storage_not_configured")
  })
})
