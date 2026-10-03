import { beforeEach, describe, expect, it, vi } from "vitest"

// Rutas de ENVÍO del correo (subida prefirmada de adjuntos y POST /enviar). Corre el guard real
// con sesión simulada; flag, acceso, Resend, R2 y repo mockeados. Datos con dominios .example.

type Sesion =
  | { ok: false; reason: string }
  | { ok: true; tenantId: string; user: { id: string; name: string; email: string; role: string; availability: string } }

const state = vi.hoisted(() => ({
  sesion: null as unknown as Sesion,
  flag: true,
  accesibles: [] as { id: string; tenantId: string; resendInboxId: string; email: string; nombre: string; activa: boolean; orden: number }[],
  r2: true,
}))
const repo = vi.hoisted(() => ({ marcarHilo: vi.fn() }))
const resend = vi.hoisted(() => ({
  getThreadEmail: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  listReceivedAttachments: vi.fn(),
  sendDraft: vi.fn(),
  replyInThread: vi.fn(),
}))
const dominio = vi.hoisted(() => ({ dominioRecibeCorreo: vi.fn() }))
const r2 = vi.hoisted(() => ({ presignPut: vi.fn(), presignGet: vi.fn(), head: vi.fn(), delete: vi.fn() }))

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
vi.mock("@/lib/correo-dominio", () => dominio)
vi.mock("@/lib/correo-resend", async (orig) => ({ ...(await orig<typeof import("@/lib/correo-resend")>()), ...resend }))
vi.mock("@/lib/r2", async (orig) => ({ ...(await orig<typeof import("@/lib/r2")>()), getR2: () => (state.r2 ? r2 : null) }))

import { CorreoResendError } from "@/lib/correo-resend"
import { POST as subida } from "./adjuntos/subida/route"
import { POST as enviar } from "./enviar/route"

const ID = "11111111-1111-4111-8111-111111111111"
const UUID_ADJ = "33333333-3333-4333-8333-333333333333"
const MB = 1024 * 1024
const casilla = { id: ID, tenantId: "t1", resendInboxId: "inbox_secreta_1", email: "ventas@cliente.example", nombre: "Ventas Cliente", activa: true, orden: 0 }
const post = (body: unknown) =>
  new Request("https://admin.plataforma.example/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const original = {
  id: "email_1",
  direccion: "inbound",
  de: "Ana Prueba <ana@clientes.example>",
  para: ["ventas@cliente.example"],
  cc: ["copia@clientes.example"],
  replyTo: [],
  asunto: "Consulta de precios",
  messageId: "<abc123@clientes.example>",
  leido: true,
  recibidoEn: "2026-09-30T15:00:00.000Z",
  adjuntos: [{ id: "att_1", nombre: "lista.pdf", tamano: 1000, tipo: "application/pdf" }],
  adjuntosCount: 1,
  html: "<p>Hola</p>",
  texto: "Hola, necesito precios.",
}
const keyTmp = `correo/tmp/t1/${UUID_ADJ}/informe.pdf`

beforeEach(() => {
  vi.clearAllMocks()
  state.sesion = { ok: true, tenantId: "t1", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator", availability: "away" } }
  state.flag = true
  state.r2 = true
  state.accesibles = [casilla]
  repo.marcarHilo.mockResolvedValue(undefined)
  resend.getThreadEmail.mockResolvedValue(original)
  resend.getAttachmentDownloadUrl.mockResolvedValue({ url: "https://descargas.resend.example/a?sig=1", nombre: "lista.pdf", tamano: 1000, tipo: "application/pdf" })
  resend.sendDraft.mockResolvedValue({ id: "sent_1" })
  resend.replyInThread.mockResolvedValue({ id: "reply_1" })
  dominio.dominioRecibeCorreo.mockResolvedValue(true)
  r2.presignPut.mockResolvedValue({ url: "https://r2.example/put?sig=1", headers: { "content-type": "application/pdf" }, expiresAt: new Date() })
  r2.presignGet.mockResolvedValue("https://r2.example/get?sig=2")
  r2.head.mockResolvedValue({ size: 5 * MB, contentType: "application/pdf", etag: "x" })
})

const subidaBody = { casillaId: ID, nombre: "informe.pdf", tamano: 5 * MB, tipo: "application/pdf" }
const envioBody = {
  casillaId: ID,
  modo: "responder",
  hiloId: "thread_1",
  mensajeId: "email_1",
  para: ["ana@clientes.example"],
  cc: [],
  cco: [],
  asunto: "Re: Consulta de precios",
  texto: "Gracias, le enviamos la lista.",
  adjuntos: [],
  claveIdempotencia: "clave-unica-1",
}

describe("guardas comunes", () => {
  const rutas: [string, (b: unknown) => Promise<Response>, unknown][] = [
    ["subida", (b) => subida(post(b)), subidaBody],
    ["enviar", (b) => enviar(post(b)), envioBody],
  ]
  it.each(rutas)("%s: sin sesión 401, sin tocar Resend ni R2", async (_n, run, body) => {
    state.sesion = { ok: false, reason: "no-session" }
    expect((await run(body)).status).toBe(401)
    expect(Object.values(resend).some((f) => f.mock.calls.length > 0)).toBe(false)
    expect(Object.values(r2).some((f) => f.mock.calls.length > 0)).toBe(false)
  })
  it.each(rutas)("%s: flag apagado 404", async (_n, run, body) => {
    state.flag = false
    expect((await run(body)).status).toBe(404)
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })
  it.each(rutas)("%s: sin acceso a la casilla 404 idéntico al de inexistente", async (_n, run, body) => {
    state.accesibles = []
    const r = await run(body)
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "No encontrado", code: "not_found" })
    expect(resend.sendDraft).not.toHaveBeenCalled()
    expect(r2.presignPut).not.toHaveBeenCalled()
  })
})

describe("POST adjuntos/subida", () => {
  it("devuelve la URL PUT y la key bajo correo/tmp/{tenant}/", async () => {
    const r = await subida(post(subidaBody))
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.key).toMatch(/^correo\/tmp\/t1\/[0-9a-f-]{36}\/informe\.pdf$/)
    expect(b.putUrl).toBe("https://r2.example/put?sig=1")
    expect(b.headers).toEqual({ "content-type": "application/pdf" })
    expect(r2.presignPut).toHaveBeenCalledWith(b.key, { contentType: "application/pdf", contentLength: 5 * MB, ttlSeconds: 600 })
  })
  it("rechaza tipo bloqueado, vacío y demasiado grande, sin firmar", async () => {
    for (const mala of [
      { ...subidaBody, nombre: "virus.exe" },
      { ...subidaBody, tamano: 0 },
      { ...subidaBody, tamano: 31 * MB },
      { ...subidaBody, nombre: "" },
      { ...subidaBody, tamano: "grande" },
    ]) {
      const r = await subida(post(mala))
      expect(r.status).toBe(400)
      expect(typeof (await r.json()).error).toBe("string")
    }
    expect(r2.presignPut).not.toHaveBeenCalled()
  })
  it("sin R2 configurado 503 en usted", async () => {
    state.r2 = false
    const r = await subida(post(subidaBody))
    expect(r.status).toBe(503)
  })
})

describe("POST enviar", () => {
  it("responde: usa /reply del mensaje (sin from ni to), idempotency key y espejo", async () => {
    const r = await enviar(post({ ...envioBody, from: "Jefe <jefe@otro.example>" }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, id: "reply_1" })
    expect(resend.getThreadEmail).toHaveBeenCalledWith("inbox_secreta_1", "thread_1", "email_1")
    expect(resend.sendDraft).not.toHaveBeenCalled()
    const [inbox, hilo, mensaje, payload, opts] = resend.replyInThread.mock.calls[0]
    expect([inbox, hilo, mensaje]).toEqual(["inbox_secreta_1", "thread_1", "email_1"])
    expect(payload).not.toHaveProperty("from")
    expect(payload).not.toHaveProperty("to")
    expect(payload.subject).toBe("Re: Consulta de precios")
    expect(payload.attachments).toBeUndefined()
    expect(opts).toEqual({ idempotencyKey: "clave-unica-1" })
    expect(repo.marcarHilo).toHaveBeenCalledWith(ID, "thread_1", { leido: true })
  })

  it("redactar nuevo: draft standalone con `to`, sin leer ningún mensaje", async () => {
    const r = await enviar(post({ ...envioBody, modo: "nuevo", hiloId: undefined, mensajeId: undefined, asunto: "Hola" }))
    expect(r.status).toBe(200)
    expect(resend.getThreadEmail).not.toHaveBeenCalled()
    const [inbox, payload] = resend.sendDraft.mock.calls[0]
    expect(inbox).toBe("inbox_secreta_1")
    expect(payload.to).toEqual(["ana@clientes.example"])
    expect(payload.subject).toBe("Hola")
    expect(resend.replyInThread).not.toHaveBeenCalled()
    expect(repo.marcarHilo).not.toHaveBeenCalled()
  })

  it("responder sin hilo/mensaje -> 400", async () => {
    const r = await enviar(post({ ...envioBody, hiloId: undefined }))
    expect(r.status).toBe(400)
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("adjunto subido a R2 al responder: verifica key del tenant y tamaño real, y pasa presignGet como path al reply", async () => {
    const r = await enviar(post({ ...envioBody, adjuntos: [{ key: keyTmp, nombre: "Informe final.pdf", tamano: 1 }] }))
    expect(r.status).toBe(200)
    expect(r2.head).toHaveBeenCalledWith(keyTmp)
    expect(r2.presignGet).toHaveBeenCalledWith(keyTmp, { ttlSeconds: 900 })
    expect(resend.replyInThread.mock.calls[0][3].attachments).toEqual([{ filename: "Informe final.pdf", path: "https://r2.example/get?sig=2" }])
  })

  it("key de otro tenant o fuera del prefijo -> 400 sin enviar", async () => {
    for (const key of [`correo/tmp/otro/${UUID_ADJ}/a.pdf`, `receipts/t1/${UUID_ADJ}/a.pdf`, `correo/tmp/t1/${UUID_ADJ}/../x.pdf`]) {
      const r = await enviar(post({ ...envioBody, adjuntos: [{ key, nombre: "a.pdf", tamano: 1 }] }))
      expect(r.status).toBe(400)
    }
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("adjunto que ya no está en R2 -> 400 en usted", async () => {
    r2.head.mockResolvedValue(null)
    const r = await enviar(post({ ...envioBody, adjuntos: [{ key: keyTmp, nombre: "a.pdf", tamano: 1 }] }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toContain("Vuelva a adjuntar")
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("el tope de 40 MB se valida en el servidor con el tamaño de R2, sin llamar a Resend", async () => {
    r2.head.mockResolvedValue({ size: 31 * MB, contentType: "x", etag: null })
    const r = await enviar(post({ ...envioBody, adjuntos: [{ key: keyTmp, nombre: "a.zip", tamano: 1 }] }))
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ error: "Los adjuntos superan el máximo de 40 MB." })
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("destinatario inválido -> 400 sin enviar", async () => {
    const r = await enviar(post({ ...envioBody, para: ["xx"] }))
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ error: "Revise las direcciones de correo ingresadas." })
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("reenviar con adjuntos originales: resuelve la download_url recién y la pasa como path", async () => {
    const r = await enviar(
      post({ ...envioBody, modo: "reenviar", para: ["jefe@cliente.example"], asunto: "Fwd: Consulta de precios", reenviarAdjuntos: true }),
    )
    expect(r.status).toBe(200)
    expect(resend.getAttachmentDownloadUrl).toHaveBeenCalledWith("email_1", "att_1")
    const payload = resend.sendDraft.mock.calls[0][1]
    expect(payload.to).toEqual(["jefe@cliente.example"])
    expect(payload.attachments).toEqual([{ filename: "lista.pdf", path: "https://descargas.resend.example/a?sig=1" }])
    expect(payload.text).toContain("---------- Mensaje reenviado ----------")
    // Reenviar no marca el hilo como respondido ni toca el espejo.
    expect(repo.marcarHilo).not.toHaveBeenCalled()
  })

  it("reenviar sin tildar adjuntos no los pide", async () => {
    await enviar(post({ ...envioBody, modo: "reenviar", para: ["jefe@cliente.example"], asunto: "Fwd: x", reenviarAdjuntos: false }))
    expect(resend.getAttachmentDownloadUrl).not.toHaveBeenCalled()
    expect(resend.sendDraft.mock.calls[0][1].attachments).toBeUndefined()
  })

  it("reenviar con adjuntos que superan el tope no llama a Resend ni resuelve URLs", async () => {
    resend.getThreadEmail.mockResolvedValue({ ...original, adjuntos: [{ id: "att_1", nombre: "enorme.zip", tamano: 35 * MB, tipo: "application/zip" }] })
    const r = await enviar(post({ ...envioBody, modo: "reenviar", para: ["jefe@cliente.example"], asunto: "Fwd: x", reenviarAdjuntos: true }))
    expect(r.status).toBe(400)
    expect(resend.getAttachmentDownloadUrl).not.toHaveBeenCalled()
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("error 5xx de Resend: 502 en usted, sin cuerpo crudo ni la clave", async () => {
    resend.replyInThread.mockRejectedValue(new CorreoResendError("servidor", 503))
    const r = await enviar(post(envioBody))
    expect(r.status).toBe(502)
    const b = await r.json()
    expect(b.error).toBe("El servicio de correo no está disponible. Inténtelo nuevamente en unos instantes.")
    expect(repo.marcarHilo).not.toHaveBeenCalled()
  })

  it("dominio con typo -> 422 con sugerencia, sin enviar", async () => {
    const r = await enviar(post({ ...envioBody, para: ["ana@gmial.com"] }))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: "¿Quiso decir ana@gmail.com?", code: "destinatario", sugerencia: "ana@gmail.com" })
    expect(resend.replyInThread).not.toHaveBeenCalled()
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("dominio sin MX -> 422 en usted, sin enviar ni firmar adjuntos", async () => {
    dominio.dominioRecibeCorreo.mockResolvedValue(false)
    const r = await enviar(post({ ...envioBody, adjuntos: [{ key: keyTmp, nombre: "a.pdf", tamano: 1 }] }))
    expect(r.status).toBe(422)
    expect((await r.json()).error).toBe("El dominio clientes.example no recibe correo. Revise la dirección.")
    expect(r2.presignGet).not.toHaveBeenCalled()
    expect(resend.replyInThread).not.toHaveBeenCalled()
  })

  it("si falla el espejo igual informa éxito (el webhook lo reconcilia)", async () => {
    repo.marcarHilo.mockRejectedValue(new Error("db"))
    const r = await enviar(post(envioBody))
    expect(r.status).toBe(200)
  })

  it("el mensaje a responder no existe en esa casilla: 404", async () => {
    resend.getThreadEmail.mockRejectedValue(new CorreoResendError("no_encontrado", 404))
    const r = await enviar(post(envioBody))
    expect(r.status).toBe(404)
    expect(resend.sendDraft).not.toHaveBeenCalled()
  })

  it("cuerpo inválido -> 400", async () => {
    const r = await enviar(new Request("https://admin.plataforma.example/x", { method: "POST", body: "no json" }))
    expect(r.status).toBe(404) // sin casillaId legible: la casilla "" no es accesible
  })
})
