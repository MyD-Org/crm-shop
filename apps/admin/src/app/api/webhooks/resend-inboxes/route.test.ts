import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import recibido from "@/lib/__fixtures__/resend-inboxes-webhook/email-received.json"
import carpeta from "@/lib/__fixtures__/resend-inboxes-webhook/thread-folder-updated.json"
import enviado from "@/lib/__fixtures__/resend-inboxes-webhook/email-sent.json"
import creado from "@/lib/__fixtures__/resend-inboxes-webhook/thread-created.json"

// Unit de la ruta del webhook de Resend Inboxes: firma, flag, idempotencia y efectos. Sin base
// ni red: repo, push y flag se mockean (el SQL real lo cubre test/integration).

const state = vi.hoisted(() => ({
  flag: true,
  casilla: null as null | { id: string; tenantId: string; nombre: string; activa: boolean },
  eventosVistos: new Set<string>(),
  hilos: [] as { casillaId: string; threadId: string; datos: Record<string, unknown> }[],
  pushes: [] as { tenantId: string; casillaId: string; payload: Record<string, unknown> }[],
  borrados: [] as string[],
  fallaUpsert: false,
  limpiezas: 0,
}))

vi.mock("@/lib/correo-flag", () => ({ correoHabilitado: async () => state.flag }))
vi.mock("@/lib/correo-repo", () => ({
  casillaPorInbox: async (inboxId: string) => (state.casilla && inboxId === "inbox_0001" ? state.casilla : null),
  registrarEvento: async (id: string) => {
    if (state.eventosVistos.has(id)) return false
    state.eventosVistos.add(id)
    return true
  },
  borrarEvento: async (id: string) => {
    state.borrados.push(id)
    state.eventosVistos.delete(id)
  },
  upsertHilo: async (casillaId: string, threadId: string, datos: Record<string, unknown>) => {
    if (state.fallaUpsert) throw new Error("base caída")
    state.hilos.push({ casillaId, threadId, datos })
    return {}
  },
  limpiarEventosViejos: async () => {
    state.limpiezas++
    return 0
  },
}))
vi.mock("@/lib/push", () => ({
  sendPushToCasilla: async (tenantId: string, casillaId: string, payload: Record<string, unknown>) => {
    state.pushes.push({ tenantId, casillaId, payload })
    return 1
  },
}))

import { POST } from "./route"

const SECRETO_B64 = Buffer.from("secreto-de-prueba-correo-0123456789").toString("base64")

function firmar(id: string, ts: string, body: string) {
  return "v1," + createHmac("sha256", Buffer.from(SECRETO_B64, "base64")).update(`${id}.${ts}.${body}`).digest("base64")
}

function llamar(
  evento: unknown,
  over: { id?: string; ts?: string; firma?: string | null; raw?: string; sinHeaders?: boolean } = {},
) {
  const raw = over.raw ?? JSON.stringify(evento)
  const id = over.id ?? "msg_1"
  const ts = over.ts ?? String(Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (!over.sinHeaders) {
    headers["svix-id"] = id
    headers["svix-timestamp"] = ts
    if (over.firma !== null) headers["svix-signature"] = over.firma ?? firmar(id, ts, raw)
  }
  return POST(new Request("https://admin.plataforma.example/api/webhooks/resend-inboxes", { method: "POST", headers, body: raw }))
}

beforeEach(() => {
  state.flag = true
  state.casilla = { id: "casilla-1", tenantId: "tenant-a", nombre: "Ventas", activa: true }
  state.eventosVistos.clear()
  state.hilos = []
  state.pushes = []
  state.borrados = []
  state.fallaUpsert = false
  state.limpiezas = 0
  process.env.RESEND_INBOXES_WEBHOOK_SECRET = `whsec_${SECRETO_B64}`
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("autenticación", () => {
  it("firma inválida o ausente: 401 sin tocar la base", async () => {
    expect((await llamar(recibido, { firma: "v1,AAAA" })).status).toBe(401)
    expect((await llamar(recibido, { firma: null })).status).toBe(401)
    expect((await llamar(recibido, { sinHeaders: true })).status).toBe(401)
    expect(state.eventosVistos.size).toBe(0)
    expect(state.hilos).toEqual([])
    expect(state.pushes).toEqual([])
  })

  it("timestamp fuera de tolerancia: 401", async () => {
    const viejo = String(Math.floor(Date.now() / 1000) - 3600)
    expect((await llamar(recibido, { ts: viejo })).status).toBe(401)
  })

  it("cuerpo alterado tras firmar: 401", async () => {
    const id = "msg_1"
    const ts = String(Math.floor(Date.now() / 1000))
    const firma = firmar(id, ts, JSON.stringify(recibido))
    expect((await llamar(recibido, { id, ts, firma, raw: JSON.stringify(recibido) + " " })).status).toBe(401)
  })

  it("sin secreto configurado: falla cerrada (401)", async () => {
    delete process.env.RESEND_INBOXES_WEBHOOK_SECRET
    expect((await llamar(recibido)).status).toBe(401)
    expect(state.hilos).toEqual([])
  })

  it("cuerpo demasiado grande: 413", async () => {
    const raw = JSON.stringify({ relleno: "x".repeat(300_000) })
    expect((await llamar(null, { raw })).status).toBe(413)
  })
})

describe("flag", () => {
  it("apagado: 200 sin procesar ni registrar el evento", async () => {
    state.flag = false
    const r = await llamar(recibido)
    expect(r.status).toBe(200)
    expect(state.eventosVistos.size).toBe(0)
    expect(state.hilos).toEqual([])
    expect(state.pushes).toEqual([])
  })
})

describe("email recibido", () => {
  it("crea el hilo sin leer en Recibidos y avisa por push a la casilla", async () => {
    const r = await llamar(recibido)
    expect(r.status).toBe(200)
    expect(state.hilos).toEqual([
      { casillaId: "casilla-1", threadId: "thread_0001", datos: expect.objectContaining({ folder: "inbox", leido: false }) },
    ])
    expect(state.pushes).toHaveLength(1)
    expect(state.pushes[0]).toMatchObject({
      tenantId: "tenant-a",
      casillaId: "casilla-1",
      payload: { title: "Correo nuevo en Ventas", body: "Consulta de precios", url: "/admin/inbox?casilla=casilla-1&hilo=thread_0001", tag: "correo-thread_0001" },
    })
  })

  it("trunca el asunto del aviso", async () => {
    const largo = { ...recibido, data: { ...recibido.data, thread: { ...recibido.data.thread, subject: "A".repeat(200) } } }
    await llamar(largo)
    expect((state.pushes[0].payload.body as string).length).toBeLessThanOrEqual(80)
  })

  it("replay del mismo svix-id: 200 sin duplicar hilo ni push", async () => {
    await llamar(recibido, { id: "msg_7" })
    const r2 = await llamar(recibido, { id: "msg_7" })
    expect(r2.status).toBe(200)
    expect(state.hilos).toHaveLength(1)
    expect(state.pushes).toHaveLength(1)
  })

  it("si el hilo cae en spam no hay push", async () => {
    const spam = { ...recibido, data: { ...recibido.data, thread: { ...recibido.data.thread, folder: "spam" } } }
    await llamar(spam)
    expect(state.hilos[0].datos).toMatchObject({ folder: "spam", leido: false })
    expect(state.pushes).toEqual([])
  })

  it("pasa la fecha del evento para que no retroceda el último evento", async () => {
    await llamar(recibido)
    expect(state.hilos[0].datos.eventoAt).toEqual(new Date("2026-09-29T12:00:00.000Z"))
  })
})

describe("otros eventos", () => {
  it("carpeta actualizada: actualiza folder (y leído) sin push", async () => {
    await llamar(carpeta)
    expect(state.hilos).toEqual([
      { casillaId: "casilla-1", threadId: "thread_0001", datos: expect.objectContaining({ folder: "archive", leido: true }) },
    ])
    expect(state.pushes).toEqual([])
  })

  it("email enviado: sin push y sin marcarlo como no leído", async () => {
    await llamar(enviado)
    expect(state.hilos[0].datos.leido).toBe(true)
    expect(state.pushes).toEqual([])
  })

  it("hilo creado: upsert sin push", async () => {
    await llamar(creado)
    expect(state.hilos).toHaveLength(1)
    expect(state.pushes).toEqual([])
  })

  it("tolera el nombre sin prefijo inbox.", async () => {
    await llamar({ ...recibido, type: "email.received" })
    expect(state.hilos).toHaveLength(1)
    expect(state.pushes).toHaveLength(1)
  })

  it("evento no soportado: 200 sin escrituras ni registrar el id", async () => {
    const r = await llamar({ ...recibido, type: "inbox.thread.labels.updated" })
    expect(r.status).toBe(200)
    expect(state.hilos).toEqual([])
    expect(state.eventosVistos.size).toBe(0)
  })

  it("JSON inválido con firma válida: 400", async () => {
    expect((await llamar(null, { raw: "{no es json" })).status).toBe(400)
  })
})

describe("casilla", () => {
  it("inbox desconocida: 200 sin escrituras", async () => {
    state.casilla = null
    const r = await llamar(recibido)
    expect(r.status).toBe(200)
    expect(state.hilos).toEqual([])
    expect(state.pushes).toEqual([])
    expect(state.eventosVistos.size).toBe(0)
  })

  it("casilla inactiva: 200 sin escrituras ni push", async () => {
    state.casilla = { id: "casilla-1", tenantId: "tenant-a", nombre: "Ventas", activa: false }
    const r = await llamar(recibido)
    expect(r.status).toBe(200)
    expect(state.hilos).toEqual([])
    expect(state.pushes).toEqual([])
  })
})

describe("fallas", () => {
  it("si falla el procesamiento: borra el registro del evento y responde 500 (Resend reintenta)", async () => {
    state.fallaUpsert = true
    const r = await llamar(recibido, { id: "msg_9" })
    expect(r.status).toBe(500)
    expect(state.borrados).toEqual(["msg_9"])
    expect(state.pushes).toEqual([])
    // el reintento sí se procesa
    state.fallaUpsert = false
    expect((await llamar(recibido, { id: "msg_9" })).status).toBe(200)
    expect(state.hilos).toHaveLength(1)
  })

  it("los logs no incluyen valores del cuerpo (asunto, remitente)", async () => {
    await llamar(recibido)
    const volcado = JSON.stringify([
      ...(console.log as unknown as { mock: { calls: unknown[] } }).mock.calls,
      ...(console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls,
      ...(console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ])
    expect(volcado).not.toContain("Consulta de precios")
    expect(volcado).not.toContain("ana@clientes.example")
  })
})
