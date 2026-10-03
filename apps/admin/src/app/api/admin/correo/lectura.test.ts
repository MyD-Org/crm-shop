import { beforeEach, describe, expect, it, vi } from "vitest"

// Rutas de LECTURA del correo. Corre el guard real (sesión simulada, flag y repo mockeados; el
// SQL real lo cubre test/integration). Datos inventados con dominios .example.

type Sesion =
  | { ok: false; reason: string }
  | { ok: true; tenantId: string; user: { id: string; name: string; email: string; role: string; availability: string } }

const state = vi.hoisted(() => ({
  sesion: null as unknown as Sesion,
  flag: true,
  accesibles: [] as { id: string; tenantId: string; resendInboxId: string; email: string; nombre: string; activa: boolean; orden: number }[],
}))
const repo = vi.hoisted(() => ({
  reconciliarHilos: vi.fn(),
  marcarHilo: vi.fn(),
}))
const resend = vi.hoisted(() => ({
  listThreads: vi.fn(),
  listThreadEmails: vi.fn(),
  getThreadEmail: vi.fn(),
  getEmailLastEvent: vi.fn(),
  patchThread: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.sesion }))
vi.mock("@/lib/correo-flag", () => ({ correoHabilitado: async () => state.flag }))
vi.mock("@/lib/correo-acceso", async () => {
  const { adminNotFoundResponse } = await import("@/lib/admin-route-guard")
  return {
    requireCasilla: async (_t: string, _a: unknown, id: string) => {
      const c = state.accesibles.find((x) => x.id === id)
      return c ? { ok: true, casilla: c } : { ok: false, response: adminNotFoundResponse() }
    },
  }
})
vi.mock("@/lib/correo-repo", () => repo)
vi.mock("@/lib/correo-resend", async (orig) => ({ ...(await orig<typeof import("@/lib/correo-resend")>()), ...resend }))

import { CorreoResendError } from "@/lib/correo-resend"
import { GET as listarHilos } from "./casillas/[id]/hilos/route"
import { PATCH as patchHilo } from "./casillas/[id]/hilos/[tid]/route"
import { GET as listarMensajes } from "./casillas/[id]/hilos/[tid]/mensajes/route"
import { GET as cuerpo } from "./casillas/[id]/hilos/[tid]/mensajes/[eid]/route"
import { GET as adjunto } from "./adjuntos/[eid]/[aid]/route"

const ID = "11111111-1111-4111-8111-111111111111"
const OTRA = "22222222-2222-4222-8222-222222222222"
const casilla = { id: ID, tenantId: "t1", resendInboxId: "inbox_secreta_1", email: "ventas@cliente.example", nombre: "Ventas", activa: true, orden: 0 }
const get = (path: string) => new Request(`https://admin.plataforma.example${path}`)
const patch = (body: unknown) =>
  new Request("https://admin.plataforma.example/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const ctx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: ID, tid: "thread_1", eid: "email_1", aid: "att_1", ...extra }) })

const URL_FIRMADA = "https://descargas.resend.example/firmada-ficticia?sig=abc"

beforeEach(() => {
  vi.clearAllMocks()
  state.sesion = { ok: true, tenantId: "t1", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator", availability: "away" } }
  state.flag = true
  state.accesibles = [casilla]
  repo.reconciliarHilos.mockResolvedValue(undefined)
  repo.marcarHilo.mockResolvedValue(undefined)
  resend.listThreads.mockResolvedValue({
    hilos: [{ id: "thread_1", asunto: "Consulta", de: "ana@clientes.example", para: [], cc: [], mensajes: 2, conAdjuntos: false, leido: false, recibidoEn: "2026-10-01T10:00:00.000Z" }],
    hasMore: true,
    siguiente: "thread_1",
  })
  resend.listThreadEmails.mockResolvedValue({
    id: "thread_1",
    asunto: "Consulta",
    carpeta: "inbox",
    leido: false,
    mensajes: [
      { id: "email_2", recibidoEn: "2026-10-01T12:00:00.000Z", adjuntos: [] },
      { id: "email_1", recibidoEn: "2026-10-01T10:00:00.000Z", adjuntos: [{ id: "att_1", nombre: "lista.pdf", tamano: 100, tipo: "application/pdf" }] },
    ],
  })
  resend.getThreadEmail.mockResolvedValue({
    id: "email_1",
    html: `<p>Hola</p><script>alert(1)</script><img src="https://pixel.example/p.gif">`,
    texto: "Hola",
    adjuntos: [{ id: "att_1", nombre: "lista.pdf", tamano: 100, tipo: "application/pdf" }],
  })
  resend.patchThread.mockResolvedValue(undefined)
  resend.getAttachmentDownloadUrl.mockResolvedValue({ url: URL_FIRMADA, nombre: "lista.pdf", tamano: 100, tipo: "application/pdf" })
})

const TODAS: [string, () => Promise<Response>][] = [
  ["GET hilos", () => listarHilos(get("/h"), ctx())],
  ["PATCH hilo", () => patchHilo(patch({ leido: true }), ctx())],
  ["GET mensajes", () => listarMensajes(get("/m"), ctx())],
  ["GET cuerpo", () => cuerpo(get("/c"), ctx())],
  ["GET adjunto", () => adjunto(get(`/a?casilla=${ID}&hilo=thread_1`), ctx())],
]

describe("guardas comunes", () => {
  it.each(TODAS)("%s: sin sesión 401, sin llamar a Resend", async (_n, run) => {
    state.sesion = { ok: false, reason: "no-session" }
    expect((await run()).status).toBe(401)
    expect(Object.values(resend).some((f) => f.mock.calls.length > 0)).toBe(false)
  })

  it.each(TODAS)("%s: flag apagado 404, sin llamar a Resend", async (_n, run) => {
    state.flag = false
    expect((await run()).status).toBe(404)
    expect(Object.values(resend).some((f) => f.mock.calls.length > 0)).toBe(false)
  })

  it.each(TODAS)("%s: sin acceso a la casilla 404 idéntico al de una inexistente, sin llamar a Resend", async (_n, run) => {
    state.accesibles = []
    const r = await run()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "No encontrado", code: "not_found" })
    expect(Object.values(resend).some((f) => f.mock.calls.length > 0)).toBe(false)
  })

  it("un operador CON acceso lee (no hace falta ser admin)", async () => {
    expect((await listarHilos(get("/h"), ctx())).status).toBe(200)
  })
})

describe("GET hilos", () => {
  it("pasa carpeta, búsqueda por asunto y cursor, y reconcilia el espejo", async () => {
    const r = await listarHilos(get("/h?folder=archive&q=factura&after=thread_0&limit=10"), ctx())
    expect(resend.listThreads).toHaveBeenCalledWith("inbox_secreta_1", { folder: "archive", q: "factura", after: "thread_0", limit: 10 })
    const body = await r.json()
    expect(body).toMatchObject({ hasMore: true, siguiente: "thread_1" })
    expect(JSON.stringify(body)).not.toContain("inbox_secreta_1")
    expect(repo.reconciliarHilos).toHaveBeenCalledWith(ID, "archive", [{ threadId: "thread_1", leido: false, recibidoEn: new Date("2026-10-01T10:00:00.000Z") }])
    expect(r.headers.get("cache-control")).toContain("no-store")
  })

  it("carpeta inválida cae a Recibidos y el límite se acota", async () => {
    await listarHilos(get("/h?folder=otra&limit=9999"), ctx())
    expect(resend.listThreads).toHaveBeenCalledWith("inbox_secreta_1", { folder: "inbox", q: undefined, after: undefined, limit: 50 })
  })

  it("si falla el espejo igual devuelve el listado", async () => {
    repo.reconciliarHilos.mockRejectedValue(new Error("db"))
    expect((await listarHilos(get("/h"), ctx())).status).toBe(200)
  })

  it("error de Resend: mensaje en usted sin cuerpo crudo", async () => {
    resend.listThreads.mockRejectedValue(new CorreoResendError("servidor", 503))
    const r = await listarHilos(get("/h"), ctx())
    expect(r.status).toBe(502)
    expect((await r.json()).error).toMatch(/Inténtelo/)
  })
})

describe("PATCH hilo", () => {
  it("marca leído en Resend y en el espejo", async () => {
    const r = await patchHilo(patch({ leido: true }), ctx())
    expect(r.status).toBe(200)
    expect(resend.patchThread).toHaveBeenCalledWith("inbox_secreta_1", "thread_1", { read: true })
    expect(repo.marcarHilo).toHaveBeenCalledWith(ID, "thread_1", { leido: true, carpeta: undefined })
  })

  it("mueve a la papelera (nunca borrado definitivo)", async () => {
    await patchHilo(patch({ carpeta: "trash" }), ctx())
    expect(resend.patchThread).toHaveBeenCalledWith("inbox_secreta_1", "thread_1", { folder: "trash" })
  })

  it.each([{ carpeta: "sent" }, { carpeta: "borrar" }, { leido: "si" }, {}, []])("rechaza %j con 400 sin llamar a Resend", async (b) => {
    const r = await patchHilo(patch(b), ctx())
    expect(r.status).toBe(400)
    expect(resend.patchThread).not.toHaveBeenCalled()
  })

  it("si Resend falla no toca el espejo", async () => {
    resend.patchThread.mockRejectedValue(new CorreoResendError("red"))
    expect((await patchHilo(patch({ leido: true }), ctx())).status).toBe(502)
    expect(repo.marcarHilo).not.toHaveBeenCalled()
  })

  it("si falla solo el espejo responde 200 (Resend ya aplicó el cambio)", async () => {
    repo.marcarHilo.mockRejectedValue(new Error("db"))
    expect((await patchHilo(patch({ leido: false }), ctx())).status).toBe(200)
  })

  it("un id de hilo con caracteres raros 404 sin llamar a Resend", async () => {
    expect((await patchHilo(patch({ leido: true }), ctx({ tid: "../x" }))).status).toBe(404)
    expect(resend.patchThread).not.toHaveBeenCalled()
  })
})

describe("GET mensajes y cuerpo", () => {
  it("devuelve los mensajes en orden cronológico, sin cuerpos ni id de inbox", async () => {
    const body = await (await listarMensajes(get("/m"), ctx())).json()
    expect(body.mensajes.map((m: { id: string }) => m.id)).toEqual(["email_1", "email_2"])
    expect(JSON.stringify(body)).not.toMatch(/inbox_secreta_1|html|download_url/)
  })

  it("avisa la entrega con problema de los salientes consultando Resend en vivo", async () => {
    resend.listThreadEmails.mockResolvedValue({
      id: "thread_1", asunto: "Consulta", carpeta: "sent", leido: true,
      mensajes: [
        { id: "email_in", direccion: "inbound", recibidoEn: "2026-10-01T10:00:00.000Z", adjuntos: [] },
        { id: "email_ok", direccion: "outbound", recibidoEn: "2026-10-01T11:00:00.000Z", adjuntos: [] },
        { id: "email_mal", direccion: "outbound", recibidoEn: "2026-10-01T12:00:00.000Z", adjuntos: [] },
        { id: "email_demora", direccion: "outbound", recibidoEn: "2026-10-01T13:00:00.000Z", adjuntos: [] },
      ],
    })
    resend.getEmailLastEvent.mockImplementation(async (id: string) => ({ email_ok: "delivered", email_mal: "bounced", email_demora: "delivery_delayed" })[id] ?? null)
    const body = await (await listarMensajes(get("/m"), ctx())).json()
    expect(body.entregas).toEqual({
      email_mal: { tono: "danger", texto: "No entregado: la dirección no existe o rechazó el mensaje." },
      email_demora: { tono: "warning", texto: "Entrega demorada." },
    })
    expect(resend.getEmailLastEvent).not.toHaveBeenCalledWith("email_in")
  })

  it("el cuerpo llega saneado, con imágenes bloqueadas y Cache-Control privado de 5 min", async () => {
    const r = await cuerpo(get("/c"), ctx())
    const body = await r.json()
    expect(body.html).not.toMatch(/<script|alert/)
    expect(body.html).toContain("data-src")
    expect(body.imagenesRemotas).toBe(1)
    expect(r.headers.get("cache-control")).toBe("private, max-age=300")
    expect(resend.getThreadEmail).toHaveBeenCalledWith("inbox_secreta_1", "thread_1", "email_1")
  })
})

describe("GET adjunto", () => {
  const pedir = (extra = "") => adjunto(get(`/a?casilla=${ID}&hilo=thread_1${extra}`), ctx())

  it("responde 302 a la URL firmada, no-store, resuelta en el momento", async () => {
    const r = await pedir()
    expect(r.status).toBe(302)
    expect(r.headers.get("location")).toBe(URL_FIRMADA)
    expect(r.headers.get("cache-control")).toContain("no-store")
    expect(resend.getAttachmentDownloadUrl).toHaveBeenCalledWith("email_1", "att_1")
  })

  it("nunca devuelve la URL en un cuerpo JSON", async () => {
    expect(await (await pedir()).text()).toBe("")
  })

  it("un adjunto que no es de ese mensaje 404 sin resolver la URL", async () => {
    const r = await adjunto(get(`/a?casilla=${ID}&hilo=thread_1`), ctx({ aid: "att_ajeno" }))
    expect(r.status).toBe(404)
    expect(resend.getAttachmentDownloadUrl).not.toHaveBeenCalled()
  })

  it("un mensaje que Resend no ubica en esa casilla/hilo 404 (sin oráculo entre casillas)", async () => {
    resend.getThreadEmail.mockRejectedValue(new CorreoResendError("no_encontrado", 404))
    expect((await pedir()).status).toBe(404)
    expect(resend.getAttachmentDownloadUrl).not.toHaveBeenCalled()
  })

  it("pasar la casilla de otro usuario (sin acceso) 404", async () => {
    const r = await adjunto(get(`/a?casilla=${OTRA}&hilo=thread_1`), ctx())
    expect(r.status).toBe(404)
    expect(resend.getThreadEmail).not.toHaveBeenCalled()
  })

  it("más de 40 MB responde 413", async () => {
    resend.getAttachmentDownloadUrl.mockResolvedValue({ url: URL_FIRMADA, nombre: "enorme.zip", tamano: 41 * 1024 * 1024, tipo: "application/zip" })
    const r = await pedir()
    expect(r.status).toBe(413)
    expect(r.headers.get("location")).toBeNull()
  })

  it("una URL que no es https no se sigue", async () => {
    resend.getAttachmentDownloadUrl.mockResolvedValue({ url: "javascript:alert(1)", nombre: "x", tamano: 1, tipo: "x" })
    expect((await pedir()).status).toBe(404)
  })

  it("sin parámetro hilo o con ids raros 404", async () => {
    expect((await adjunto(get(`/a?casilla=${ID}`), ctx())).status).toBe(404)
    expect((await adjunto(get(`/a?casilla=${ID}&hilo=thread_1`), ctx({ eid: "a/b" }))).status).toBe(404)
  })
})
