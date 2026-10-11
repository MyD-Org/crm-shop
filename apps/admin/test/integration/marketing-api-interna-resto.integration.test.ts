// test/integration/marketing-api-interna-resto.integration.test.ts
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { seedTenant, truncateAll } from "./helpers"
import { actualizarInteraccion, crearSolicitud } from "@/lib/marketing/otros-repo"

const T = "tenant-mkt"
const S = { studio: "s-studio", planificador: "s-planner", aiapi: "s-aiapi" }

const marca = await import("@/app/api/internal/marketing/marca/route")
const solicitudes = await import("@/app/api/internal/marketing/solicitudes/route")
const resolver = await import("@/app/api/internal/marketing/solicitudes/[id]/resolver/route")
const metricas = await import("@/app/api/internal/marketing/metricas/route")
const interacciones = await import("@/app/api/internal/marketing/interacciones/route")
const interaccion = await import("@/app/api/internal/marketing/interacciones/[id]/route")
const campanas = await import("@/app/api/internal/marketing/campanas/route")
const catalogo = await import("@/app/api/internal/marketing/catalogo/route")

function req(path: string, secreto: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://crm.cliente.example/api/internal/marketing${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${secreto}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

describe("API interna de marketing: resto del contrato", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    vi.stubEnv("MARKETING_TENANT_ID", T)
    vi.stubEnv("MARKETING_STUDIO_SECRET", S.studio)
    vi.stubEnv("MARKETING_PLANNER_SECRET", S.planificador)
    vi.stubEnv("MARKETING_AIAPI_SECRET", S.aiapi)
  })

  it("GET /marca crea la marca vacía la primera vez", async () => {
    const r = await marca.GET(req("/marca", S.planificador))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ voz: "", reglas: [] })
  })

  it("GET /campanas devuelve sólo las del estado pedido", async () => {
    const { getDb } = await import("@/db")
    const { marketingCampanas } = await import("@/db/schema")
    await getDb().insert(marketingCampanas).values([{ tenantId: T, nombre: "Apertura MDP" }, { tenantId: T, nombre: "Vieja", estado: "cerrada" }])
    const r = await campanas.GET(req("/campanas?estado=activa", S.planificador))
    expect((await r.json()).items.map((c: { nombre: string }) => c.nombre)).toEqual(["Apertura MDP"])
  })

  it("la rutina lista y resuelve solicitudes; ai-api no puede", async () => {
    const s = await crearSolicitud(T, "plan_semana")
    expect((await solicitudes.GET(req("/solicitudes?estado=pendiente", S.aiapi))).status).toBe(403)
    const lista = await (await solicitudes.GET(req("/solicitudes?estado=pendiente", S.planificador))).json()
    expect(lista.items).toHaveLength(1)
    const r = await resolver.POST(req(`/solicitudes/${s.id}/resolver`, S.planificador, { method: "POST", body: { ok: true, resultado: "listo" } }), { params: Promise.resolve({ id: s.id }) })
    expect((await r.json()).estado).toBe("resuelta")
  })

  it("ai-api guarda métricas; 400 si una fila es inválida", async () => {
    const ok = await metricas.POST(req("/metricas", S.aiapi, { method: "POST", body: { filas: [{ ambito: "cuenta_ig", refId: "ig", fecha: "2026-10-12", metricas: { seguidores: 10 } }] } }))
    expect(await ok.json()).toEqual({ guardadas: 1 })
    const mal = await metricas.POST(req("/metricas", S.aiapi, { method: "POST", body: { filas: [{ ambito: "otro", refId: "x", fecha: "2026-10-12", metricas: {} }] } }))
    expect(mal.status).toBe(400)
  })

  it("ai-api carga un comentario, lee los aprobados y lo marca respondido", async () => {
    const r = await interacciones.POST(req("/interacciones", S.aiapi, { method: "POST", body: { origen: "comentario", externoId: "c1", autor: "@ana", texto: "¿Tienen tiras LED?", categoria: "consulta", sentimiento: "neutro", respuestaSugerida: "¡Sí! Le escribimos por privado." } }))
    expect(r.status).toBe(201)
    const creada = await r.json()
    expect((await (await interacciones.GET(req("/interacciones?estado=aprobada", S.aiapi))).json()).items).toEqual([])
    // El operador aprueba desde el admin; recién entonces ai-api la ve y puede marcarla respondida.
    await actualizarInteraccion(T, creada.id, "aprobar")
    expect((await (await interacciones.GET(req("/interacciones?estado=aprobada", S.aiapi))).json()).items).toHaveLength(1)
    const marcada = await interaccion.PATCH(req(`/interacciones/${creada.id}`, S.aiapi, { method: "PATCH", body: { accion: "marcar_respondida" } }), { params: Promise.resolve({ id: creada.id }) })
    expect((await marcada.json()).estado).toBe("respondida")
  })

  it("marcar respondida una interacción todavía pendiente es 409 invalid_state; si no existe, 404", async () => {
    const creada = await (await interacciones.POST(req("/interacciones", S.aiapi, { method: "POST", body: { origen: "comentario", externoId: "c2", autor: "@bea", texto: "Hola", categoria: "elogio" } }))).json()
    const r = await interaccion.PATCH(req(`/interacciones/${creada.id}`, S.aiapi, { method: "PATCH", body: { accion: "marcar_respondida" } }), { params: Promise.resolve({ id: creada.id }) })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: "invalid_state" })
    const nada = "00000000-0000-4000-8000-000000000000"
    const r404 = await interaccion.PATCH(req(`/interacciones/${nada}`, S.aiapi, { method: "PATCH", body: { accion: "marcar_respondida" } }), { params: Promise.resolve({ id: nada }) })
    expect(r404.status).toBe(404)
  })

  it("GET /catalogo responde la vista reducida (vacía sin productos) y ai-api no accede", async () => {
    const r = await catalogo.GET(req("/catalogo?q=led&limite=5", S.planificador))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ items: [] })
    expect((await catalogo.GET(req("/catalogo", S.aiapi))).status).toBe(403)
  })
})
