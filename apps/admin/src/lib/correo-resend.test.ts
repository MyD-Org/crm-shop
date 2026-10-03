import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import inboxesJson from "./__fixtures__/resend-inboxes/inboxes.json"
import threadsJson from "./__fixtures__/resend-inboxes/threads.json"
import threadJson from "./__fixtures__/resend-inboxes/thread.json"
import threadEmailsJson from "./__fixtures__/resend-inboxes/thread-emails.json"
import emailJson from "./__fixtures__/resend-inboxes/email.json"
import emailMinimoJson from "./__fixtures__/resend-inboxes/email-minimo.json"
import attachmentsJson from "./__fixtures__/resend-inboxes/attachments.json"
import downloadJson from "./__fixtures__/resend-inboxes/attachment-download.json"
import error429Json from "./__fixtures__/resend-inboxes/error-429.json"
import {
  CorreoResendError,
  _internos,
  getAttachmentDownloadUrl,
  getThreadEmail,
  listInboxes,
  listReceivedAttachments,
  listThreadEmails,
  listThreads,
  patchThread,
  sendEmail,
  sendDraft,
  replyInThread,
  getEmailLastEvent,
  _limpiarCacheEventos,
} from "./correo-resend"

const CLAVE = "re_clave_de_prueba_no_real"

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}

let fetchMock: ReturnType<typeof vi.fn>
let esperas: number[]

beforeEach(() => {
  process.env.RESEND_API_KEY_EMAILS = CLAVE
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  esperas = []
  _internos.sleep = async (ms: number) => {
    esperas.push(ms)
  }
})
afterEach(() => {
  delete process.env.RESEND_API_KEY_EMAILS
  vi.unstubAllGlobals()
})

describe("clave", () => {
  it("sin RESEND_API_KEY_EMAILS lanza 'no configurado' sin hacer fetch", async () => {
    delete process.env.RESEND_API_KEY_EMAILS
    await expect(listInboxes()).rejects.toMatchObject({ code: "no_configurado" })
    await expect(listThreads("i", { folder: "inbox" })).rejects.toBeInstanceOf(CorreoResendError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("manda la clave como Bearer solo en el header", async () => {
    fetchMock.mockResolvedValueOnce(json(inboxesJson))
    await listInboxes()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.resend.com/inboxes")
    expect(init.headers.Authorization).toBe(`Bearer ${CLAVE}`)
    expect(String(url)).not.toContain(CLAVE)
  })
})

describe("normalizadores (contrato con fixtures)", () => {
  it("listInboxes", async () => {
    fetchMock.mockResolvedValueOnce(json(inboxesJson))
    const r = await listInboxes()
    expect(r).toEqual([
      { id: "inbox_ventas_0001", email: "ventas@cliente.example", nombre: "Ventas" },
      { id: "inbox_soporte_0002", email: "soporte@cliente.example", nombre: "" },
    ])
  })

  it("listThreads: tipos propios, cursor y filtros en la query", async () => {
    fetchMock.mockResolvedValueOnce(json(threadsJson))
    const r = await listThreads("inbox_ventas_0001", { folder: "inbox", q: "factura", after: "thread_0000", limit: 20 })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe("/inboxes/inbox_ventas_0001/threads")
    expect(url.searchParams.get("folder")).toBe("inbox")
    expect(url.searchParams.get("query")).toBe("factura")
    expect(url.searchParams.get("after")).toBe("thread_0000")
    expect(url.searchParams.get("limit")).toBe("20")
    expect(r.hasMore).toBe(true)
    expect(r.siguiente).toBe("thread_0002")
    expect(r.hilos[0]).toEqual({
      id: "thread_0001",
      asunto: "Consulta de precios",
      de: "Ana Prueba <ana@clientes.example>",
      para: ["ventas@cliente.example"],
      cc: [],
      mensajes: 2,
      conAdjuntos: true,
      leido: false,
      recibidoEn: "2026-09-30T15:00:00.000Z",
    })
  })

  it("tolera campos ausentes: has_attachment=false y cc=[]", async () => {
    fetchMock.mockResolvedValueOnce(json(threadsJson))
    const r = await listThreads("i", { folder: "inbox" })
    expect(r.hilos[1]).toMatchObject({ conAdjuntos: false, cc: [], leido: true, mensajes: 1 })
  })

  it("listThreadEmails une el hilo (GET /threads/{id}) con sus mensajes (GET /threads/{id}/emails)", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      json(new URL(String(url)).pathname.endsWith("/emails") ? threadEmailsJson : threadJson),
    )
    const r = await listThreadEmails("i", "thread_0001")
    const paths = fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname).sort()
    expect(paths).toEqual(["/inboxes/i/threads/thread_0001", "/inboxes/i/threads/thread_0001/emails"])
    expect(r).toMatchObject({ id: "thread_0001", asunto: "Consulta de precios", carpeta: "inbox", leido: false })
    expect(r.mensajes).toHaveLength(2)
    expect(r.mensajes[0]).toMatchObject({
      id: "email_0001",
      direccion: "inbound",
      cc: [],
      replyTo: [],
      messageId: "<abc123@clientes.example>",
      adjuntosCount: 2,
      adjuntos: [{ id: "att_0001", nombre: "lista.pdf", tamano: 120400 }, { id: "att_0002" }],
    })
    // La lista trae html/text completos: el detalle de metadatos NO los arrastra.
    expect(JSON.stringify(r)).not.toContain("necesito precios")
    expect(r.mensajes[1]).toMatchObject({ direccion: "outbound", cc: ["jefe@clientes.example"], adjuntosCount: 0 })
  })

  it("getThreadEmail devuelve cuerpo, message_id, reply_to y adjuntos", async () => {
    fetchMock.mockResolvedValueOnce(json(emailJson))
    const m = await getThreadEmail("i", "t", "email_0001")
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/inboxes/i/threads/t/emails/email_0001")
    expect(m).toMatchObject({
      messageId: "<abc123@clientes.example>",
      replyTo: ["respuestas@clientes.example"],
      cc: ["copia@clientes.example"],
      html: "<p>Hola, necesito precios.</p>",
      texto: "Hola, necesito precios.",
      adjuntos: [{ id: "att_0001", nombre: "lista.pdf", tamano: 120400, tipo: "application/pdf" }],
    })
  })

  it("getThreadEmail tolera una respuesta mínima", async () => {
    fetchMock.mockResolvedValueOnce(json(emailMinimoJson))
    const m = await getThreadEmail("i", "t", "email_0009")
    expect(m).toMatchObject({ para: [], cc: [], replyTo: [], adjuntos: [], html: null, texto: null, messageId: null, direccion: "inbound" })
  })

  it("listReceivedAttachments y getAttachmentDownloadUrl", async () => {
    fetchMock.mockResolvedValueOnce(json(attachmentsJson))
    const l = await listReceivedAttachments("email_0001")
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/emails/receiving/email_0001/attachments")
    expect(l).toEqual([{ id: "att_0001", nombre: "lista.pdf", tamano: 120400, tipo: "application/pdf" }])

    fetchMock.mockResolvedValueOnce(json(downloadJson))
    const d = await getAttachmentDownloadUrl("email_0001", "att_0001")
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe("/emails/receiving/email_0001/attachments/att_0001")
    expect(d).toEqual({ url: "https://descargas.resend.example/firmada-ficticia", nombre: "lista.pdf", tamano: 120400, tipo: "application/pdf" })
  })

  it("patchThread manda read y folder", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "t" }))
    await patchThread("i", "t", { read: true, folder: "archive" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe("PATCH")
    expect(new URL(String(url)).pathname).toBe("/inboxes/i/threads/t")
    expect(JSON.parse(init.body)).toEqual({ read: true, folder: "archive" })
  })

  it("sendEmail hace POST /emails y devuelve el id", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "sent_1" }))
    const r = await sendEmail({ from: "Ventas <ventas@cliente.example>", to: ["a@clientes.example"], subject: "Re: x", html: "<p>x</p>", text: "x" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.resend.com/emails")
    expect(init.method).toBe("POST")
    expect(r).toEqual({ id: "sent_1" })
  })

  it("sendEmail manda Idempotency-Key (el recibido, o uno propio) y los headers de hilado", async () => {
    fetchMock.mockResolvedValue(json({ id: "sent_1" }))
    const payload = { from: "Ventas <ventas@cliente.example>", to: ["a@clientes.example"], subject: "Re: x", text: "x", headers: { "In-Reply-To": "<a@x.example>" } }
    await sendEmail(payload, { idempotencyKey: "clave-1" })
    await sendEmail(payload)
    const [, init1] = fetchMock.mock.calls[0]
    const [, init2] = fetchMock.mock.calls[1]
    expect(init1.headers["Idempotency-Key"]).toBe("clave-1")
    expect(init2.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(init1.body).headers).toEqual({ "In-Reply-To": "<a@x.example>" })
  })

  it("el reintento de un envío por 5xx reusa la misma Idempotency-Key", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ id: "sent_2" }))
    await sendEmail({ from: "a <a@x.example>", to: ["b@x.example"], subject: "x", text: "x" })
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1][1].headers["Idempotency-Key"])
  })
})

describe("errores normalizados", () => {
  const casos: [number, string][] = [
    [401, "no_autorizado"],
    [403, "prohibido"],
    [404, "no_encontrado"],
    [422, "invalido"],
    [500, "servidor"],
  ]
  it.each(casos)("status %i -> %s, sin cuerpo crudo ni clave", async (status, code) => {
    fetchMock.mockResolvedValue(json({ name: "x", message: `detalle interno secreto ${CLAVE}` }, status))
    const err = await listInboxes().catch((e) => e)
    expect(err).toBeInstanceOf(CorreoResendError)
    expect(err.code).toBe(code)
    expect(err.status).toBe(status)
    expect(err.message).not.toContain("secreto")
    expect(err.message).not.toContain(CLAVE)
    expect(err.message).toMatch(/[a-záéíóú]/i)
  })

  it("error de red", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(listInboxes()).rejects.toMatchObject({ code: "red" })
  })

  it("404 no se reintenta", async () => {
    fetchMock.mockResolvedValue(json({}, 404))
    await listInboxes().catch(() => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("5xx se reintenta hasta 3 veces y luego falla", async () => {
    fetchMock.mockResolvedValue(json({}, 503))
    await expect(listInboxes()).rejects.toMatchObject({ code: "servidor" })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe("rate limit", () => {
  it("429 transitorio reintenta y devuelve el 200", async () => {
    fetchMock.mockResolvedValueOnce(json(error429Json, 429)).mockResolvedValueOnce(json(inboxesJson))
    const r = await listInboxes()
    expect(r).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(esperas).toHaveLength(1)
  })

  it("429 persistente -> límite con mensaje en usted", async () => {
    fetchMock.mockResolvedValue(json(error429Json, 429))
    const err = await listInboxes().catch((e) => e)
    expect(err).toMatchObject({ code: "limite", status: 429, message: "Inténtelo nuevamente en unos instantes." })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("respeta Retry-After (segundos)", async () => {
    fetchMock.mockResolvedValueOnce(json(error429Json, 429, { "retry-after": "2" })).mockResolvedValueOnce(json(inboxesJson))
    await listInboxes()
    expect(esperas[0]).toBeGreaterThanOrEqual(2000)
  })

  it("backoff exponencial sin Retry-After", async () => {
    fetchMock.mockResolvedValue(json(error429Json, 429))
    await listInboxes().catch(() => {})
    expect(esperas).toHaveLength(3)
    expect(esperas[1]).toBeGreaterThan(esperas[0])
    expect(esperas[2]).toBeGreaterThan(esperas[1])
  })

  it("responder: POST .../reply con cc/bcc/subject/attachments y sin `to`", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "re_1", email_id: "em_1" }))
    const r = await replyInThread(
      "inbox_x", "th_9", "em_9",
      { cc: ["b@x.example"], subject: "Re: Hola", html: "<p>Hi</p>", text: "Hi", attachments: [{ filename: "a.pdf", path: "https://r2.example/a" }] },
      { idempotencyKey: "clave-1" },
    )
    expect(r).toEqual({ id: "em_1" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.resend.com/inboxes/inbox_x/threads/th_9/emails/em_9/reply")
    expect(init.method).toBe("POST")
    expect(init.headers["Idempotency-Key"]).toBe("clave-1")
    expect(JSON.parse(init.body)).toEqual({
      cc: ["b@x.example"], subject: "Re: Hola", html: "<p>Hi</p>", text: "Hi", attachments: [{ filename: "a.pdf", path: "https://r2.example/a" }],
    })
  })

  it("redactar/reenviar: crea el draft standalone y lo envía", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "dr_1" })).mockResolvedValueOnce(json({ id: "sd_1", thread_id: "th_2", email_id: "em_2" }))
    const r = await sendDraft("inbox_x", { to: ["a@x.example"], subject: "Hola", html: "<p>Hi</p>", text: "Hi" })
    expect(r).toEqual({ id: "em_2" })
    const [url1, init1] = fetchMock.mock.calls[0]
    expect(String(url1)).toBe("https://api.resend.com/inboxes/inbox_x/drafts")
    const body = JSON.parse(init1.body)
    expect(body.thread_id).toBeUndefined()
    expect(body.to).toEqual(["a@x.example"])
    const [url2, init2] = fetchMock.mock.calls[1]
    expect(String(url2)).toBe("https://api.resend.com/inboxes/inbox_x/drafts/dr_1/send")
    expect(init2.method).toBe("POST")
  })

  it("si el draft no devuelve id lanza error de servidor", async () => {
    fetchMock.mockResolvedValueOnce(json({}))
    await expect(sendDraft("inbox_x", { to: ["a@x.example"], subject: "s", text: "t" })).rejects.toMatchObject({ code: "servidor" })
  })

  it("getEmailLastEvent: lee last_event, cachea y no lanza ante errores", async () => {
    _limpiarCacheEventos()
    fetchMock.mockResolvedValueOnce(json({ id: "em_1", last_event: "bounced" }))
    expect(await getEmailLastEvent("em_1", 1000)).toBe("bounced")
    expect(await getEmailLastEvent("em_1", 2000)).toBe("bounced")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.resend.com/emails/em_1")
    // vencido el TTL se vuelve a pedir
    fetchMock.mockResolvedValueOnce(json({ last_event: "delivered" }))
    expect(await getEmailLastEvent("em_1", 1000 + 61_000)).toBe("delivered")
    // 404 -> null
    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 404))
    expect(await getEmailLastEvent("em_x", 1000)).toBeNull()
  })

  it("concurrencia máxima 4 en vuelo", async () => {
    let enVuelo = 0
    let maximo = 0
    fetchMock.mockImplementation(async () => {
      enVuelo++
      maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enVuelo--
      return json(inboxesJson)
    })
    await Promise.all(Array.from({ length: 12 }, () => listInboxes()))
    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(maximo).toBeLessThanOrEqual(4)
    expect(maximo).toBeGreaterThan(1)
  })
})
