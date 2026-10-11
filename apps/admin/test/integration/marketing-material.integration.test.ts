// Subida de material del equipo: POST firma la URL PUT a R2, PUT confirma y registra. DB real
// (crm_test) y guard real; el bucket es un FakeR2 en memoria y la sesión se simula.
import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { getDb } from "@/db"
import { marketingMaterial } from "@/db/schema"
import { FakeR2 } from "./fake-r2"
import { seedOperator, seedTenant, truncateAll } from "./helpers"
import { crearPieza, obtenerPieza, transicionar } from "@/lib/marketing/piezas-repo"

let session: Record<string, unknown> = {}
const r2 = vi.hoisted(() => ({ actual: null as unknown }))
vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-mkt" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/shop-media", async (orig) => ({
  ...(await orig<typeof import("@/lib/shop-media")>()),
  getShopMediaR2: () => r2.actual,
}))

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

let fake: FakeR2
const filas = async () => (await getDb().select().from(marketingMaterial)).length

/** Firma una subida y deja el objeto en el bucket falso (como si el navegador hubiera subido). */
async function firmar(piezaId: string, contentType: string, bytes: number, subido: { size?: number; contentType?: string | null } | false = {}) {
  const { key } = await (await material.POST(req(piezaId, { contentType, bytes }, "POST"), ctx(piezaId))).json()
  if (subido) fake.objects.set(key, { body: new Uint8Array(subido.size ?? bytes), contentType: subido.contentType === undefined ? contentType : subido.contentType })
  return key as string
}

describe("subida de material", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    invalidateTenantRegistry()
    login(await seedOperator(T, { role: "admin" }))
    fake = new FakeR2()
    r2.actual = fake
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("400 para un tipo no permitido o un archivo demasiado grande", async () => {
    const p = await nuevaPieza()
    expect((await material.POST(req(p.id, { contentType: "application/pdf", bytes: 10 }, "POST"), ctx(p.id))).status).toBe(400)
    expect((await material.POST(req(p.id, { contentType: "video/mp4", bytes: 400 * 1024 * 1024 }, "POST"), ctx(p.id))).status).toBe(400)
  })

  it("no deja pasar claves heredadas de Object como tipo", async () => {
    const p = await nuevaPieza()
    for (const contentType of ["constructor", "__proto__", "toString"]) {
      const r = await material.POST(req(p.id, { contentType, bytes: 1_000_000_000 }, "POST"), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_tipo")
    }
    expect(fake.calls.presignPut).toBe(0)
  })

  it("400 si bytes no es un número entero positivo", async () => {
    const p = await nuevaPieza()
    for (const bytes of ["5", 0, -1, 1.5, null]) {
      const r = await material.POST(req(p.id, { contentType: "video/mp4", bytes }, "POST"), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_bytes")
    }
    const grande = await material.POST(req(p.id, { contentType: "video/mp4", bytes: 400 * 1024 * 1024 }, "POST"), ctx(p.id))
    expect((await grande.json()).error).toContain("supera el tamaño máximo")
    expect(fake.calls.presignPut).toBe(0)
  })

  it("firma la subida y al confirmar la pieza pasa a borrador", async () => {
    const p = await nuevaPieza()
    const firmado = await (await material.POST(req(p.id, { contentType: "video/mp4", bytes: 5_000_000 }, "POST"), ctx(p.id))).json()
    expect(firmado.key).toMatch(new RegExp(`^marketing/${T}/material/${p.id}/[0-9a-f-]+\\.mp4$`))
    expect(firmado.url).toContain(firmado.key)
    expect(firmado.headers).toEqual({ "content-type": "video/mp4" })
    fake.objects.set(firmado.key, { body: new Uint8Array(5_000_000), contentType: "video/mp4" })
    const r = await material.PUT(req(p.id, { key: firmado.key, contentType: "video/mp4", bytes: 5_000_000 }, "PUT"), ctx(p.id))
    expect(r.status).toBe(201)
    expect((await obtenerPieza(T, p.id))!.estado).toBe("borrador")
    expect(await filas()).toBe(1)
  })

  it("400 si la key confirmada no es de esta pieza ni de este tenant", async () => {
    const p = await nuevaPieza()
    const otra = await nuevaPieza()
    for (const key of [
      `marketing/${T}/material/${otra.id}/${randomUUID()}.mp4`,
      `marketing/otro/material/${p.id}/${randomUUID()}.mp4`,
    ]) {
      fake.objects.set(key, { body: new Uint8Array(10), contentType: "video/mp4" })
      const r = await material.PUT(req(p.id, { key, contentType: "video/mp4", bytes: 10 }, "PUT"), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_key")
    }
    expect(fake.calls.head).toBe(0)
    expect(await filas()).toBe(0)
  })

  it("400 not_uploaded si el archivo nunca llegó al bucket", async () => {
    const p = await nuevaPieza()
    const key = await firmar(p.id, "video/mp4", 1000, false)
    const r = await material.PUT(req(p.id, { key, contentType: "video/mp4", bytes: 1000 }, "PUT"), ctx(p.id))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe("not_uploaded")
    expect(await filas()).toBe(0)
    expect((await obtenerPieza(T, p.id))!.estado).toBe("esperando_material")
  })

  it("400 mismatch si el tamaño o el tipo subidos no coinciden con lo declarado", async () => {
    const p = await nuevaPieza()
    const casos: [string, Parameters<typeof firmar>[3]][] = [
      ["tamaño", { size: 999 }],
      ["tipo del objeto", { contentType: "image/png" }],
    ]
    for (const [, subido] of casos) {
      const key = await firmar(p.id, "video/mp4", 1000, subido)
      const r = await material.PUT(req(p.id, { key, contentType: "video/mp4", bytes: 1000 }, "PUT"), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("mismatch")
    }
    // contentType declarado distinto de la extensión de la key (key .mp4, se declara una foto)
    const key = await firmar(p.id, "video/mp4", 1000)
    fake.objects.set(key, { body: new Uint8Array(1000), contentType: "image/png" })
    const r = await material.PUT(req(p.id, { key, contentType: "image/png", bytes: 1000 }, "PUT"), ctx(p.id))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe("mismatch")
    expect(await filas()).toBe(0)
    expect((await obtenerPieza(T, p.id))!.estado).toBe("esperando_material")
  })

  it("409 si la key ya fue registrada", async () => {
    const p = await nuevaPieza()
    const key = await firmar(p.id, "image/png", 1000)
    const cuerpo = { key, contentType: "image/png", bytes: 1000 }
    expect((await material.PUT(req(p.id, cuerpo, "PUT"), ctx(p.id))).status).toBe(201)
    const r = await material.PUT(req(p.id, cuerpo, "PUT"), ctx(p.id))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: "Este archivo ya fue registrado", code: "duplicate" })
  })

  it("409 si la pieza ya no admite material (POST y PUT)", async () => {
    const p = await nuevaPieza()
    const key = await firmar(p.id, "video/mp4", 1000)
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

  it("503 si el almacenamiento no está configurado (POST y PUT)", async () => {
    const p = await nuevaPieza()
    const key = `marketing/${T}/material/${p.id}/${randomUUID()}.mp4`
    r2.actual = null
    const post = await material.POST(req(p.id, { contentType: "video/mp4", bytes: 10 }, "POST"), ctx(p.id))
    expect(post.status).toBe(503)
    expect((await post.json()).code).toBe("storage_not_configured")
    const put = await material.PUT(req(p.id, { key, contentType: "video/mp4", bytes: 10 }, "PUT"), ctx(p.id))
    expect(put.status).toBe(503)
  })
})
