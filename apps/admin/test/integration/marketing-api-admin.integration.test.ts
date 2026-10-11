// API admin de marketing: piezas, solicitudes, comentarios y marca. DB real (crm_test) y guard
// real (requireAdminPlus: rol y tenant salen de la fila de admin_users, no de la cookie).
import { NextRequest } from "next/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { crearSolicitud, guardarInteraccion, listarSolicitudes } from "@/lib/marketing/otros-repo"
import { getDb } from "@/db"
import { sql } from "drizzle-orm"
import { crearPieza, obtenerPieza, reclamarPieza, transicionar } from "@/lib/marketing/piezas-repo"
import { obtenerMarca } from "@/lib/marketing/marca-repo"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

let session: Record<string, unknown> = {}

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
// Passthrough con espía: permite simular que la cola de solicitudes falla.
vi.mock("@/lib/marketing/otros-repo", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/marketing/otros-repo")>()
  return { ...m, crearSolicitud: vi.fn(m.crearSolicitud) }
})

const piezas = await import("@/app/api/admin/marketing/piezas/route")
const piezaAdmin = await import("@/app/api/admin/marketing/piezas/[id]/route")
const stories = await import("@/app/api/admin/marketing/piezas/aprobar-stories/route")
const solicitudes = await import("@/app/api/admin/marketing/solicitudes/route")
const interaccion = await import("@/app/api/admin/marketing/interacciones/[id]/route")
const marca = await import("@/app/api/admin/marketing/marca/route")

const T = "tenant-a"
const OTRO = "tenant-b"

function login(userId: string, tenantId = T) {
  session = { userId, role: "admin", tenantId, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
}

function req(path: string, body?: unknown, method = body === undefined ? "GET" : "PATCH") {
  return new NextRequest(`http://${T}.localhost/api/admin/marketing${path}`, {
    method,
    headers: { host: `${T}.localhost`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const base = { canal: "instagram", formato: "reel", plantilla: "producto-destacado", publico: "ambos", tema: "producto", objetivo: "alcance", produccion: "auto" } as const
const NOT_FOUND = { error: "No encontrado", code: "not_found" }

async function enRevision(formato: "reel" | "story" = "reel", programadaPara?: Date, tenant = T) {
  const p = await crearPieza(tenant, { ...base, formato, programadaPara }, { tipo: "planificador", nombre: "rutina" })
  await reclamarPieza(tenant, p.id, "w1", 600)
  await transicionar(tenant, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: "k.mp4" } })
  return p
}

const comentario = (externoId = "c1") =>
  guardarInteraccion(T, { origen: "comentario", externoId, autor: "@ana", texto: "¿Precio?", categoria: "consulta", sentimiento: "neutro", respuestaSugerida: "Le escribimos" })

describe("API admin de marketing", () => {
  let adminId: string

  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    await seedTenant(OTRO)
    invalidateTenantRegistry()
    adminId = await seedOperator(T, { role: "admin", name: "Ana" })
    login(adminId)
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("piezas", () => {
    it("aprueba una pieza en revisión", async () => {
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))
      expect(r.status).toBe(200)
      expect((await r.json()).estado).toBe("aprobada")
    })

    it("pedir cambios exige nota y encola una solicitud para la rutina", async () => {
      const p = await enRevision()
      expect((await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios" }), ctx(p.id))).status).toBe(400)
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Usá otra foto" }), ctx(p.id))
      expect((await r.json()).estado).toBe("cambios_pedidos")
      expect(await listarSolicitudes(T, "pendiente")).toMatchObject([{ tipo: "cambios", piezaId: p.id, nota: "Usá otra foto" }])
    })

    it("no encola la solicitud si el pedido de cambios no prospera", async () => {
      const p = await enRevision()
      await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "descartar" }), ctx(p.id))
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Tarde" }), ctx(p.id))
      expect(r.status).toBe(409)
      expect(await listarSolicitudes(T, "pendiente")).toEqual([])
    })

    it("si falla la cola tras pedir cambios: 500, y al reintentar se encola y responde 200", async () => {
      const p = await enRevision()
      vi.mocked(crearSolicitud).mockRejectedValueOnce(new Error("db caída"))
      const r1 = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Otra foto" }), ctx(p.id))
      expect(r1.status).toBe(500)
      expect((await obtenerPieza(T, p.id))?.estado).toBe("cambios_pedidos")
      expect(await listarSolicitudes(T, "pendiente")).toEqual([])
      const r2 = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Otra foto" }), ctx(p.id))
      expect(r2.status).toBe(200)
      expect((await r2.json()).estado).toBe("cambios_pedidos")
      expect(await listarSolicitudes(T, "pendiente")).toMatchObject([{ tipo: "cambios", piezaId: p.id, nota: "Otra foto" }])
    })

    it("pedir cambios sobre una pieza ya en cambios_pedidos sin solicitud: 200 y la encola", async () => {
      const p = await enRevision()
      await transicionar(T, p.id, "cambios_pedidos", "usuario", { nombreActor: "Ana", nota: "Otra foto" })
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Otra foto" }), ctx(p.id))
      expect(r.status).toBe(200)
      expect(await listarSolicitudes(T, "pendiente")).toMatchObject([{ tipo: "cambios", piezaId: p.id }])
    })

    it("pedir cambios dos veces no duplica la solicitud: la segunda es 409", async () => {
      const p = await enRevision()
      await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Otra foto" }), ctx(p.id))
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Otra foto" }), ctx(p.id))
      expect(r.status).toBe(409)
      expect(await listarSolicitudes(T, "pendiente")).toHaveLength(1)
    })

    it("GET libera un claim vencido antes de listar", async () => {
      const p = await crearPieza(T, base, { tipo: "planificador", nombre: "rutina" })
      await reclamarPieza(T, p.id, "w1", 600)
      await getDb().execute(sql`update marketing_piezas set claim_hasta = now() - interval '1 minute' where id = ${p.id}`)
      const r = await piezas.GET(req("/piezas"))
      expect(r.status).toBe(200)
      expect((await r.json()).items).toMatchObject([{ id: p.id, estado: "borrador", claimPor: null }])
      expect(await obtenerPieza(T, p.id)).toMatchObject({ estado: "borrador", claimPor: null })
    })

    it("desde fallida: aprobar vuelve a aprobada y descartar la descarta", async () => {
      const p = await enRevision()
      await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))
      await getDb().execute(sql`update marketing_piezas set estado = 'fallida' where id = ${p.id}`)
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))
      expect(r.status).toBe(200)
      expect((await r.json()).estado).toBe("aprobada")
      await getDb().execute(sql`update marketing_piezas set estado = 'fallida' where id = ${p.id}`)
      const d = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "descartar" }), ctx(p.id))
      expect(d.status).toBe(200)
      expect((await d.json()).estado).toBe("descartada")
    })

    it("desde cambios_pedidos se puede descartar", async () => {
      const p = await enRevision()
      await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "pedir_cambios", nota: "Otra foto" }), ctx(p.id))
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "descartar" }), ctx(p.id))
      expect((await r.json()).estado).toBe("descartada")
    })

    it("editar con el mismo contenido no versiona la pieza", async () => {
      const p = await enRevision()
      const antes = await obtenerPieza(T, p.id)
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar", caption: antes!.caption, contenido: antes!.contenido }), ctx(p.id))
      expect(r.status).toBe(200)
      expect(await obtenerPieza(T, p.id)).toEqual(antes)
    })

    it("editar rechaza un contenido de más de 64 KB: 400 invalid_contenido", async () => {
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar", contenido: { texto: "x".repeat(70 * 1024) } }), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_contenido")
    })

    it("editar sin nada que cambiar: 400 empty_edit", async () => {
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar" }), ctx(p.id))
      expect(r.status).toBe(400)
      expect(await r.json()).toEqual({ error: "Indique qué quiere cambiar", code: "empty_edit" })
      expect((await obtenerPieza(T, p.id))?.estado).toBe("para_revisar")
    })

    it("editar rechaza hashtags que no son texto o son demasiado largos", async () => {
      const p = await enRevision()
      for (const hashtags of [[1, 2], ["#" + "a".repeat(50)], Array.from({ length: 31 }, () => "#a")]) {
        const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar", hashtags }), ctx(p.id))
        expect(r.status).toBe(400)
        expect((await r.json()).code).toBe("invalid_hashtags")
      }
    })

    it("editar rechaza un caption que no es texto o supera 2200 caracteres", async () => {
      const p = await enRevision()
      for (const caption of [5, "c".repeat(2201)]) {
        const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar", caption }), ctx(p.id))
        expect(r.status).toBe(400)
        expect((await r.json()).code).toBe("invalid_caption")
      }
    })

    it("marcar publicada rechaza un permalink de más de 500 caracteres", async () => {
      const p = await enRevision()
      await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "marcar_publicada", permalink: "https://x.example/" + "a".repeat(500) }), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_permalink")
    })

    it("409 con mensaje en usted si la transición no es válida", async () => {
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "marcar_publicada" }), ctx(p.id))
      expect(r.status).toBe(409)
      expect(await r.json()).toEqual({ error: "La pieza no puede pasar a ese estado desde el estado actual", code: "invalid_transition" })
    })

    it("marca como publicada una pieza aprobada y valida el permalink", async () => {
      const p = await enRevision()
      await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))
      const mala = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "marcar_publicada", permalink: "http://x.example/p" }), ctx(p.id))
      expect(mala.status).toBe(400)
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "marcar_publicada", permalink: "https://instagram.example/p/1" }), ctx(p.id))
      expect(await r.json()).toMatchObject({ estado: "publicada", permalink: "https://instagram.example/p/1" })
    })

    it("editar vuelve la pieza a borrador y recalcula el contenido", async () => {
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar", caption: "Nuevo texto", hashtags: ["#a"] }), ctx(p.id))
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ estado: "borrador", caption: "Nuevo texto", hashtags: ["#a"] })
    })

    it("editar rechaza un contenido que no es objeto", async () => {
      const p = await enRevision()
      expect((await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "editar", contenido: [1] }), ctx(p.id))).status).toBe(400)
    })

    it("acción desconocida: 400", async () => {
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "borrar" }), ctx(p.id))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_accion")
    })

    it("GET devuelve la pieza con sus eventos; una pieza ajena o inexistente es 404", async () => {
      const p = await enRevision()
      const ok = await piezaAdmin.GET(req(`/piezas/${p.id}`), ctx(p.id))
      const cuerpo = await ok.json()
      expect(cuerpo.pieza.id).toBe(p.id)
      expect(cuerpo.eventos.length).toBeGreaterThan(0)
      const ajena = await enRevision("reel", undefined, OTRO)
      const r = await piezaAdmin.GET(req(`/piezas/${ajena.id}`), ctx(ajena.id))
      expect(r.status).toBe(404)
      expect(await r.json()).toEqual(NOT_FOUND)
      expect((await piezaAdmin.PATCH(req(`/piezas/${ajena.id}`, { accion: "aprobar" }), ctx(ajena.id))).status).toBe(404)
      expect((await obtenerPieza(OTRO, ajena.id))?.estado).toBe("para_revisar")
    })

    it("crea una pieza manual con origen usuario y la lista", async () => {
      const r = await piezas.POST(req("/piezas", { ...base, caption: "Hola" }, "POST"))
      expect(r.status).toBe(201)
      const creada = await r.json()
      expect(creada).toMatchObject({ estado: "borrador", caption: "Hola" })
      const lista = await (await piezas.GET(req("/piezas"))).json()
      expect(lista.items.map((x: { id: string }) => x.id)).toEqual([creada.id])
    })

    it("rechaza una pieza inválida con 400", async () => {
      const r = await piezas.POST(req("/piezas", { ...base, formato: "holograma" }, "POST"))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_formato")
    })
  })

  describe("stories en lote", () => {
    it("aprueba en lote sólo las stories en revisión de la semana", async () => {
      const lunes = new Date("2026-10-12T15:00:00Z")
      await enRevision("story", lunes)
      await enRevision("story", lunes)
      await enRevision("reel", lunes)
      await enRevision("story", new Date("2026-10-26T15:00:00Z"))
      const r = await stories.POST(req("/piezas/aprobar-stories", { desde: "2026-10-12", hasta: "2026-10-19" }, "POST"))
      expect(await r.json()).toEqual({ aprobadas: 2 })
    })

    it("400 sin rango válido", async () => {
      const r = await stories.POST(req("/piezas/aprobar-stories", { desde: "ayer" }, "POST"))
      expect(r.status).toBe(400)
    })
  })

  describe("solicitudes", () => {
    it("encola un plan semanal", async () => {
      const r = await solicitudes.POST(req("/solicitudes", { tipo: "plan_semana" }, "POST"))
      expect(r.status).toBe(201)
      expect(await listarSolicitudes(T, "pendiente")).toHaveLength(1)
    })

    it("dos clics en Planificar semana: una sola solicitud pendiente, y la segunda respuesta devuelve esa", async () => {
      const r1 = await solicitudes.POST(req("/solicitudes", { tipo: "plan_semana" }, "POST"))
      const r2 = await solicitudes.POST(req("/solicitudes", { tipo: "plan_semana" }, "POST"))
      expect([r1.status, r2.status]).toEqual([201, 200])
      expect((await r2.json()).id).toBe((await r1.json()).id)
      expect(await listarSolicitudes(T, "pendiente")).toHaveLength(1)
    })

    it("una solicitud plan_semana de otro tenant no bloquea la de este", async () => {
      await crearSolicitud(OTRO, "plan_semana")
      const r = await solicitudes.POST(req("/solicitudes", { tipo: "plan_semana" }, "POST"))
      expect(r.status).toBe(201)
    })

    it("rechaza otros tipos", async () => {
      const r = await solicitudes.POST(req("/solicitudes", { tipo: "cambios" }, "POST"))
      expect(r.status).toBe(400)
    })
  })

  describe("comentarios", () => {
    it("aprueba la respuesta a un comentario con texto editado", async () => {
      const i = await comentario()
      const r = await interaccion.PATCH(req(`/interacciones/${i.id}`, { accion: "aprobar", respuesta: "¡Te escribimos por privado!" }), ctx(i.id))
      expect(await r.json()).toMatchObject({ estado: "aprobada", respuestaFinal: "¡Te escribimos por privado!" })
    })

    it("aprobar sin respuesta propia y sin sugerida: 400 empty_reply y no cambia el estado", async () => {
      const i = await guardarInteraccion(T, { origen: "comentario", externoId: "vacio", autor: "@ana", texto: "Hola", categoria: "elogio", sentimiento: "positivo", respuestaSugerida: "" })
      const r = await interaccion.PATCH(req(`/interacciones/${i.id}`, { accion: "aprobar", respuesta: "   " }), ctx(i.id))
      expect(r.status).toBe(400)
      expect(await r.json()).toEqual({ error: "Escriba una respuesta antes de aprobar", code: "empty_reply" })
      const ok = await interaccion.PATCH(req(`/interacciones/${i.id}`, { accion: "aprobar", respuesta: "Gracias" }), ctx(i.id))
      expect(await ok.json()).toMatchObject({ estado: "aprobada", respuestaFinal: "Gracias" })
    })

    it("aprobar dos veces: la segunda es 409", async () => {
      const i = await comentario()
      expect((await interaccion.PATCH(req(`/interacciones/${i.id}`, { accion: "aprobar" }), ctx(i.id))).status).toBe(200)
      const r = await interaccion.PATCH(req(`/interacciones/${i.id}`, { accion: "aprobar", respuesta: "otra" }), ctx(i.id))
      expect(r.status).toBe(409)
      expect(await r.json()).toEqual({ error: "Este comentario ya fue tratado", code: "invalid_state" })
    })

    it("un id inexistente es 404", async () => {
      const r = await interaccion.PATCH(req("/interacciones/00000000-0000-4000-8000-000000000000", { accion: "ignorar" }), ctx("00000000-0000-4000-8000-000000000000"))
      expect(r.status).toBe(404)
      expect(await r.json()).toEqual(NOT_FOUND)
    })

    it("acción desconocida: 400", async () => {
      const i = await comentario()
      expect((await interaccion.PATCH(req(`/interacciones/${i.id}`, { accion: "borrar" }), ctx(i.id))).status).toBe(400)
    })
  })

  describe("marca", () => {
    it("guarda voz y reglas y las devuelve", async () => {
      const reglas = [{ id: "dir", texto: "Sin dirección exacta", patron: "alberti 4221", severidad: "alta" }]
      const r = await marca.PUT(req("/marca", { voz: "Cercana", reglas, hashtagsBase: ["#mdp"] }, "PUT"))
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ voz: "Cercana", reglas, hashtagsBase: ["#mdp"] })
      expect((await (await marca.GET(req("/marca"))).json()).voz).toBe("Cercana")
    })

    it("las reglas se guardan sólo con id, texto, severidad y patron (sin campos extra)", async () => {
      const r = await marca.PUT(req("/marca", { reglas: [{ id: "a", texto: "A", severidad: "alta", patron: "uno|dos", extra: "x", __proto: 1 }, { id: "b", texto: "B", severidad: "media", otro: true }] }, "PUT"))
      expect(r.status).toBe(200)
      expect((await obtenerMarca(T)).reglas).toEqual([
        { id: "a", texto: "A", severidad: "alta", patron: "uno|dos" },
        { id: "b", texto: "B", severidad: "media" },
      ])
    })

    it("rechaza una regla con frases inválidas: 400 invalid_patron y no guarda nada", async () => {
      const muchas = Array.from({ length: 21 }, (_, k) => `frase ${k}`).join("|")
      for (const patron of [muchas, "a", " | ", "x".repeat(81)]) {
        const reglas = [{ id: "mala", texto: "Mala", patron, severidad: "media" }]
        const r = await marca.PUT(req("/marca", { voz: "No debe guardarse", reglas }, "PUT"))
        expect(r.status).toBe(400)
        const cuerpo = await r.json()
        expect(cuerpo.code).toBe("invalid_patron")
        expect(typeof cuerpo.error).toBe("string")
      }
      expect((await obtenerMarca(T)).voz).toBe("")
    })

    it("una regla con aspecto de regex se guarda como frase literal", async () => {
      const reglas = [{ id: "lit", texto: "Literal", patron: "((a+))+$", severidad: "media" }]
      expect((await marca.PUT(req("/marca", { reglas }, "PUT"))).status).toBe(200)
    })

    it("topes de recursos: reglas, id, texto, voz y hashtags", async () => {
      const regla = (extra: object = {}) => ({ id: "r", texto: "R", severidad: "media", ...extra })
      const casos: [string, unknown, string][] = [
        ["51 reglas", { reglas: Array.from({ length: 51 }, (_, k) => regla({ id: `r${k}` })) }, "invalid_reglas"],
        ["id vacío", { reglas: [regla({ id: "" })] }, "invalid_reglas"],
        ["id largo", { reglas: [regla({ id: "i".repeat(61) })] }, "invalid_reglas"],
        ["texto vacío", { reglas: [regla({ texto: "" })] }, "invalid_reglas"],
        ["texto largo", { reglas: [regla({ texto: "t".repeat(301) })] }, "invalid_reglas"],
        ["regla no objeto", { reglas: ["x"] }, "invalid_reglas"],
        ["voz larga", { voz: "v".repeat(4001) }, "invalid_voz"],
        ["31 hashtags", { hashtagsBase: Array.from({ length: 31 }, () => "#a") }, "invalid_hashtags"],
        ["hashtag largo", { hashtagsBase: ["#" + "a".repeat(50)] }, "invalid_hashtags"],
        ["hashtag no texto", { hashtagsBase: [1] }, "invalid_hashtags"],
      ]
      for (const [nombre, cuerpo, code] of casos) {
        const r = await marca.PUT(req("/marca", cuerpo, "PUT"))
        expect(r.status, nombre).toBe(400)
        expect((await r.json()).code, nombre).toBe(code)
      }
    })

    it("valida la forma de reparto, horarios y política de comentarios", async () => {
      const casos: [string, unknown, string][] = [
        ["reparto con clave ajena", { reparto: { publico: { amigos: 10 } } }, "invalid_reparto"],
        ["reparto fuera de rango", { reparto: { tema: { producto: 101 } } }, "invalid_reparto"],
        ["reparto no numérico", { reparto: { publico: { ambos: "10" } } }, "invalid_reparto"],
        ["reparto con otra sección", { reparto: { otro: {} } }, "invalid_reparto"],
        ["reparto arreglo", { reparto: [] }, "invalid_reparto"],
        ["horario día inválido", { horariosPreferidos: { festivo: ["10:00"] } }, "invalid_horarios"],
        ["horario hora inválida", { horariosPreferidos: { lunes: ["25:00"] } }, "invalid_horarios"],
        ["más de 6 horarios", { horariosPreferidos: { lunes: Array.from({ length: 7 }, () => "10:00") } }, "invalid_horarios"],
        ["política categoría ajena", { politicaComentarios: { otra: "auto" } }, "invalid_politica"],
        ["política valor ajeno", { politicaComentarios: { queja: "borrar" } }, "invalid_politica"],
      ]
      for (const [nombre, cuerpo, code] of casos) {
        const r = await marca.PUT(req("/marca", cuerpo, "PUT"))
        expect(r.status, nombre).toBe(400)
        expect((await r.json()).code, nombre).toBe(code)
      }
      const ok = await marca.PUT(
        req("/marca", { reparto: { publico: { profesional: 60, consumidor: 40 }, tema: { tecnico: 30 } }, horariosPreferidos: { lunes: ["10:00", "19:30"] }, politicaComentarios: { queja: "derivar", spam: "ocultar" } }, "PUT"),
      )
      expect(ok.status).toBe(200)
    })

    it("rechaza reglas mal formadas", async () => {
      const r = await marca.PUT(req("/marca", { reglas: [{ id: "x", texto: "X", severidad: "baja" }] }, "PUT"))
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe("invalid_reglas")
    })
  })

  describe("acceso", () => {
    it("401 sin sesión", async () => {
      session = {}
      const p = await enRevision()
      expect((await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))).status).toBe(401)
      expect((await marca.GET(req("/marca"))).status).toBe(401)
    })

    it("un operador (sin rol admin) recibe 404", async () => {
      const operador = await seedOperator(T, { role: "operator", email: "op@example.com" })
      login(operador)
      const p = await enRevision()
      const r = await piezaAdmin.PATCH(req(`/piezas/${p.id}`, { accion: "aprobar" }), ctx(p.id))
      expect(r.status).toBe(404)
      expect((await obtenerPieza(T, p.id))?.estado).toBe("para_revisar")
    })
  })
})
