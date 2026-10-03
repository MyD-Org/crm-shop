import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import recibido from "./__fixtures__/resend-inboxes-webhook/email-received.json"
import carpeta from "./__fixtures__/resend-inboxes-webhook/thread-folder-updated.json"
import enviado from "./__fixtures__/resend-inboxes-webhook/email-sent.json"
import creado from "./__fixtures__/resend-inboxes-webhook/thread-created.json"
import { TOLERANCIA_SEGUNDOS, parsearEventoCorreo, verificarFirmaSvix } from "./correo-webhook"

const SECRETO_BASE64 = Buffer.from("secreto-de-prueba-correo-0123456789").toString("base64")
const SECRETO = `whsec_${SECRETO_BASE64}`
const AHORA = new Date("2026-09-29T12:00:00.000Z")
const TS = String(Math.floor(AHORA.getTime() / 1000))
const BODY = JSON.stringify(recibido)

function firmar(id: string, ts: string, body: string, secretoB64 = SECRETO_BASE64) {
  return "v1," + createHmac("sha256", Buffer.from(secretoB64, "base64")).update(`${id}.${ts}.${body}`).digest("base64")
}

function verificar(over: Partial<Parameters<typeof verificarFirmaSvix>[0]> = {}) {
  return verificarFirmaSvix({
    id: "msg_1",
    timestamp: TS,
    signature: firmar("msg_1", TS, BODY),
    rawBody: BODY,
    secret: SECRETO,
    now: AHORA,
    ...over,
  })
}

describe("verificarFirmaSvix", () => {
  it("acepta una firma válida (con y sin prefijo whsec_)", () => {
    expect(verificar()).toBe(true)
    expect(verificar({ secret: SECRETO_BASE64 })).toBe(true)
  })

  it("rechaza firma inválida, cuerpo alterado o secreto distinto", () => {
    expect(verificar({ signature: "v1,AAAA" })).toBe(false)
    expect(verificar({ rawBody: BODY + " " })).toBe(false)
    expect(verificar({ secret: "whsec_" + Buffer.from("otro").toString("base64") })).toBe(false)
  })

  it("rechaza headers ausentes o vacíos", () => {
    expect(verificar({ id: null })).toBe(false)
    expect(verificar({ timestamp: null })).toBe(false)
    expect(verificar({ signature: null })).toBe(false)
    expect(verificar({ signature: "" })).toBe(false)
  })

  it("rechaza timestamps fuera de la tolerancia (pasado y futuro) y no numéricos", () => {
    const viejo = String(Number(TS) - TOLERANCIA_SEGUNDOS - 1)
    const futuro = String(Number(TS) + TOLERANCIA_SEGUNDOS + 1)
    expect(verificar({ timestamp: viejo, signature: firmar("msg_1", viejo, BODY) })).toBe(false)
    expect(verificar({ timestamp: futuro, signature: firmar("msg_1", futuro, BODY) })).toBe(false)
    expect(verificar({ timestamp: "abc", signature: firmar("msg_1", "abc", BODY) })).toBe(false)
    const justo = String(Number(TS) - TOLERANCIA_SEGUNDOS)
    expect(verificar({ timestamp: justo, signature: firmar("msg_1", justo, BODY) })).toBe(true)
  })

  it("falla cerrada sin secreto configurado o con secreto vacío", () => {
    expect(verificar({ secret: undefined })).toBe(false)
    expect(verificar({ secret: "" })).toBe(false)
    expect(verificar({ secret: "whsec_" })).toBe(false)
  })

  it("acepta si alguna de varias firmas v1 coincide e ignora versiones desconocidas", () => {
    const buena = firmar("msg_1", TS, BODY)
    expect(verificar({ signature: `v1,AAAA ${buena}` })).toBe(true)
    expect(verificar({ signature: `v2,${buena.slice(3)}` })).toBe(false)
  })
})

describe("parsearEventoCorreo", () => {
  it("email recibido: inbox, hilo, dirección, asunto y estado", () => {
    expect(parsearEventoCorreo(recibido)).toEqual({
      tipo: "email_recibido",
      inboxId: "inbox_0001",
      threadId: "thread_0001",
      direccion: "inbound",
      carpeta: "inbox",
      leido: false,
      asunto: "Consulta de precios",
      ocurridoAt: new Date("2026-09-29T12:00:00.000Z"),
    })
  })

  it("carpeta actualizada: toma la carpeta destino", () => {
    expect(parsearEventoCorreo(carpeta)).toMatchObject({ tipo: "carpeta", threadId: "thread_0001", carpeta: "archive", leido: true })
  })

  it("hilo creado y email enviado", () => {
    expect(parsearEventoCorreo(creado)).toMatchObject({ tipo: "hilo_creado", direccion: "inbound", carpeta: "inbox" })
    expect(parsearEventoCorreo(enviado)).toMatchObject({ tipo: "email_enviado", direccion: "outbound" })
  })

  it("tolera el nombre sin prefijo inbox.", () => {
    for (const [fx, tipo] of [
      [recibido, "email_recibido"],
      [carpeta, "carpeta"],
      [enviado, "email_enviado"],
      [creado, "hilo_creado"],
    ] as const) {
      const sinPrefijo = { ...fx, type: fx.type.replace(/^inbox\./, "") }
      expect(parsearEventoCorreo(sinPrefijo)?.tipo).toBe(tipo)
    }
  })

  it("ignora eventos no soportados, el email.received de dominio (sin inbox_id) y basura", () => {
    expect(parsearEventoCorreo({ ...recibido, type: "inbox.thread.labels.updated" })).toBeNull()
    expect(parsearEventoCorreo({ ...recibido, type: "inbox.updated" })).toBeNull()
    expect(parsearEventoCorreo({ type: "email.received", created_at: "2026-09-29T12:00:00.000Z", data: { email_id: "x", to: ["a@b.example"] } })).toBeNull()
    expect(parsearEventoCorreo(null)).toBeNull()
    expect(parsearEventoCorreo("texto")).toBeNull()
    expect(parsearEventoCorreo({ type: "inbox.email.received" })).toBeNull()
  })

  it("es tolerante: sin thread, sin created_at válido y carpeta desconocida", () => {
    const e = parsearEventoCorreo({
      type: "inbox.email.received",
      created_at: "no-es-fecha",
      data: { inbox_id: "i", thread_id: "t", thread: { folder: "rara" }, email: { direction: "inbound" } },
    })
    expect(e).toMatchObject({ tipo: "email_recibido", carpeta: "inbox", leido: false, asunto: null })
    expect(e?.ocurridoAt).toBeInstanceOf(Date)
  })
})
