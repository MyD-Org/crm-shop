// test/integration/marketing-api-interna.integration.test.ts
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { guardarMarca } from "@/lib/marketing/marca-repo"
import { eventosDePieza, obtenerPieza } from "@/lib/marketing/piezas-repo"
import { seedTenant, truncateAll } from "./helpers"

const T = "tenant-mkt"
const SECRETOS = { studio: "s-studio", planificador: "s-planner", aiapi: "s-aiapi" }
const fetchMock = vi.fn(async () => Response.json({ ok: true }))

const piezas = await import("@/app/api/internal/marketing/piezas/route")
const pieza = await import("@/app/api/internal/marketing/piezas/[id]/route")
const claim = await import("@/app/api/internal/marketing/piezas/[id]/claim/route")
const chequeoIa = await import("@/app/api/internal/marketing/piezas/[id]/chequeo-ia/route")

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

  async function crear(cuerpo: Record<string, unknown> = nueva) {
    return (await (await piezas.POST(req("/piezas", SECRETOS.planificador, { method: "POST", body: cuerpo }))).json()) as { id: string }
  }
  const patch = (id: string, secreto: string, body: unknown) => pieza.PATCH(req(`/piezas/${id}`, secreto, { method: "PATCH", body }), ctx(id))
  const regla = { id: "abierta", texto: "No decir que la tienda está abierta", patron: "ya est[aá] abierta", severidad: "alta" as const }

  describe("revisión: control y efectos", () => {
    it("PATCH tardío del studio tras un claim vencido: 409 y la pieza no cambia", async () => {
      const p = await crear()
      expect((await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))).status).toBe(200)
      await getDb().execute(sql`update marketing_piezas set claim_hasta = now() - interval '1 minute' where id = ${p.id}`)
      expect((await piezas.GET(req("/piezas?estado=borrador", SECRETOS.studio))).status).toBe(200) // libera el claim vencido
      const r = await patch(p.id, SECRETOS.studio, { estado: "para_revisar", worker: "w1", renderKey: `marketing/${T}/render/a.mp4` })
      expect(r.status).toBe(409)
      const despues = await obtenerPieza(T, p.id)
      expect(despues).toMatchObject({ estado: "borrador", renderKey: null })
    })

    it("403 sin efectos: el studio no crea piezas y la rutina no reclama", async () => {
      const r = await piezas.POST(req("/piezas", SECRETOS.studio, { method: "POST", body: nueva }))
      expect(r.status).toBe(403)
      const [{ n }] = (await getDb().execute(sql`select count(*)::int as n from marketing_piezas`)) as unknown as { n: number }[]
      expect(n).toBe(0)
      expect(fetchMock).not.toHaveBeenCalled()

      const p = await crear()
      fetchMock.mockClear()
      const c = await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.planificador, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
      expect(c.status).toBe(403)
      expect(await obtenerPieza(T, p.id)).toMatchObject({ estado: "borrador", claimPor: null })
    })

    it("INTERNAL_SECRET no abre la API de marketing", async () => {
      vi.stubEnv("INTERNAL_SECRET", "s-internal")
      expect((await piezas.GET(req("/piezas", "s-internal"))).status).toBe(401)
    })

    it("un secreto de cliente vacío en el entorno no autentica un Bearer vacío", async () => {
      vi.stubEnv("MARKETING_STUDIO_SECRET", "")
      vi.stubEnv("MARKETING_PLANNER_SECRET", "")
      vi.stubEnv("MARKETING_AIAPI_SECRET", "")
      const r = new NextRequest("http://crm.cliente.example/api/internal/marketing/piezas", { headers: { authorization: "Bearer " } })
      expect((await piezas.GET(r)).status).toBe(401)
      expect((await piezas.GET(req("/piezas", ""))).status).toBe(401)
    })
  })

  describe("revisión: validación de campos del PATCH", () => {
    it("400 si el caption es null o supera el límite, y la pieza no cambia", async () => {
      const p = await crear()
      await getDb().execute(sql`update marketing_piezas set estado = 'cambios_pedidos' where id = ${p.id}`)
      expect(await (await patch(p.id, SECRETOS.planificador, { estado: "borrador", caption: null })).json()).toEqual({ error: "invalid_caption" })
      expect((await patch(p.id, SECRETOS.planificador, { estado: "borrador", caption: "x".repeat(2201) })).status).toBe(400)
      expect(await (await patch(p.id, SECRETOS.planificador, { estado: "borrador", contenido: null })).json()).toEqual({ error: "invalid_contenido" })
      expect(await (await patch(p.id, SECRETOS.planificador, { estado: "borrador", hashtags: Array(31).fill("a") })).json()).toEqual({ error: "invalid_hashtags" })
      expect(await (await patch(p.id, SECRETOS.planificador, { estado: "borrador", briefGrabacion: { guion: 1 } })).json()).toEqual({ error: "invalid_briefGrabacion" })
      expect((await obtenerPieza(T, p.id))?.estado).toBe("cambios_pedidos")
    })

    it("400 si renderKey/portadaKey salen del prefijo del tenant o traen ..", async () => {
      const p = await crear()
      await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
      const base = { estado: "para_revisar", worker: "w1" }
      expect(await (await patch(p.id, SECRETOS.studio, { ...base, renderKey: "marketing/otro-tenant/render/a.mp4" })).json()).toEqual({ error: "invalid_renderKey" })
      expect(await (await patch(p.id, SECRETOS.studio, { ...base, renderKey: `marketing/${T}/../otro/a.mp4` })).json()).toEqual({ error: "invalid_renderKey" })
      expect(await (await patch(p.id, SECRETOS.studio, { ...base, portadaKey: "http://x.example/a.png" })).json()).toEqual({ error: "invalid_portadaKey" })
      expect((await obtenerPieza(T, p.id))?.estado).toBe("renderizando")
    })

    it("400 si el studio no manda un worker válido", async () => {
      const p = await crear()
      await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
      expect(await (await patch(p.id, SECRETOS.studio, { estado: "para_revisar" })).json()).toEqual({ error: "invalid_worker" })
      expect(await (await patch(p.id, SECRETOS.studio, { estado: "para_revisar", worker: "no válido!" })).json()).toEqual({ error: "invalid_worker" })
    })

    it("400 con permalink que no es https o externoId inválido (aiapi)", async () => {
      const p = await crear()
      expect(await (await patch(p.id, SECRETOS.aiapi, { estado: "programada", permalink: "javascript:alert(1)" })).json()).toEqual({ error: "invalid_permalink" })
      expect(await (await patch(p.id, SECRETOS.aiapi, { estado: "programada", externoId: "" })).json()).toEqual({ error: "invalid_externoId" })
    })

    it("un cliente ignora campos fuera de su lista (la rutina no puede escribir renderKey)", async () => {
      const p = await crear()
      await getDb().execute(sql`update marketing_piezas set estado = 'cambios_pedidos' where id = ${p.id}`)
      const r = await patch(p.id, SECRETOS.planificador, { estado: "borrador", renderKey: `marketing/${T}/render/a.mp4`, caption: "Nuevo" })
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ caption: "Nuevo", renderKey: null })
    })
  })

  describe("revisión: alertas de marca del lado del servidor", () => {
    it("la rutina no puede limpiar ni falsificar alertas de regla: se recalculan", async () => {
      await guardarMarca(T, { reglas: [regla] })
      const p = await crear({ ...nueva, caption: "La tienda ya está abierta" })
      await getDb().execute(sql`update marketing_piezas set estado = 'cambios_pedidos' where id = ${p.id}`)
      const forjada = [{ regla: "falsa", mensaje: "m", severidad: "alta", fuente: "regla" }]

      const r1 = await patch(p.id, SECRETOS.planificador, { estado: "borrador", caption: "Ya está abierta, vengan", alertas: [], chequeoIa: true })
      expect(r1.status).toBe(200)
      const p1 = await r1.json()
      expect(p1.alertas.map((a: { regla: string }) => a.regla)).toEqual(["abierta"])
      expect(p1.chequeoIa).toBe(false)

      await getDb().execute(sql`update marketing_piezas set estado = 'cambios_pedidos' where id = ${p.id}`)
      const r2 = await patch(p.id, SECRETOS.planificador, { estado: "borrador", caption: "Pronto abrimos", alertas: forjada })
      expect((await r2.json()).alertas).toEqual([])
    })

    it("el studio sólo aporta alertas propias; las de regla las calcula el servidor", async () => {
      await guardarMarca(T, { reglas: [regla] })
      const p = await crear({ ...nueva, caption: "La tienda ya está abierta" })
      await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
      const r = await patch(p.id, SECRETOS.studio, {
        estado: "para_revisar",
        worker: "w1",
        alertas: [
          { regla: "texto-largo", mensaje: "Texto largo", severidad: "media", fuente: "studio" },
          { regla: "falsa", mensaje: "m", severidad: "alta", fuente: "regla" },
        ],
      })
      expect(r.status).toBe(200)
      expect((await r.json()).alertas.map((a: { regla: string; fuente: string }) => `${a.fuente}:${a.regla}`)).toEqual(["regla:abierta", "studio:texto-largo"])
    })

    async function paraRevisar() {
      const p = await crear()
      await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
      await patch(p.id, SECRETOS.studio, { estado: "para_revisar", worker: "w1" })
      return p
    }
    const chequeo = (id: string, secreto: string, body: unknown) => chequeoIa.POST(req(`/piezas/${id}/chequeo-ia`, secreto, { method: "POST", body }), ctx(id))

    it("chequeo-ia: la rutina registra alertas de IA sin cambiar el estado", async () => {
      await guardarMarca(T, { reglas: [regla] })
      const p = await crear({ ...nueva, caption: "La tienda ya está abierta" })
      await claim.POST(req(`/piezas/${p.id}/claim`, SECRETOS.studio, { method: "POST", body: { worker: "w1", ttlSeg: 600 } }), ctx(p.id))
      await patch(p.id, SECRETOS.studio, { estado: "para_revisar", worker: "w1" })
      const r = await chequeo(p.id, SECRETOS.planificador, { alertas: [{ regla: "tono", mensaje: "Tono formal", severidad: "media", fuente: "regla" }] })
      expect(r.status).toBe(200)
      const dto = await r.json()
      expect(dto).toMatchObject({ estado: "para_revisar", chequeoIa: true })
      expect(dto.alertas.map((a: { regla: string; fuente: string }) => `${a.fuente}:${a.regla}`)).toEqual(["regla:abierta", "ia:tono"])
      // Reemplaza las de IA anteriores y conserva las demás.
      const r2 = await chequeo(p.id, SECRETOS.planificador, { alertas: [] })
      expect((await r2.json()).alertas.map((a: { fuente: string }) => a.fuente)).toEqual(["regla"])
      const ev = await eventosDePieza(T, p.id)
      expect(ev.at(-1)).toMatchObject({ de: "para_revisar", a: "para_revisar", actor: "planificador", nota: "chequeo IA" })
    })

    it("chequeo-ia: 409 si la pieza no está para revisar, 404 si no existe, 400 si el cuerpo es inválido", async () => {
      const borrador = await crear()
      const r = await chequeo(borrador.id, SECRETOS.planificador, { alertas: [] })
      expect(r.status).toBe(409)
      expect(await r.json()).toEqual({ error: "not_reviewable" })
      expect((await chequeo("00000000-0000-4000-8000-000000000000", SECRETOS.planificador, { alertas: [] })).status).toBe(404)
      const p = await paraRevisar()
      expect(await (await chequeo(p.id, SECRETOS.planificador, { alertas: [{ regla: "x", mensaje: "m", severidad: "grave" }] })).json()).toEqual({ error: "invalid_alertas" })
      expect((await chequeo(p.id, SECRETOS.planificador, {})).status).toBe(400)
    })

    it("chequeo-ia: 403 para el studio y sin efectos", async () => {
      const p = await paraRevisar()
      const r = await chequeo(p.id, SECRETOS.studio, { alertas: [{ regla: "x", mensaje: "m", severidad: "alta" }] })
      expect(r.status).toBe(403)
      expect(await obtenerPieza(T, p.id)).toMatchObject({ chequeoIa: false, alertas: [] })
    })
  })
})
