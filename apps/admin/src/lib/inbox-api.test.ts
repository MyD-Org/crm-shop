import { describe, it, expect, vi } from "vitest"
import { channelLabel, contactRowKey, contactThreadHref, sendReply } from "./inbox-api"

describe("channelLabel", () => {
  it("mapea los canales conocidos a su nombre legible", () => {
    expect(channelLabel("whatsapp")).toBe("WhatsApp")
    expect(channelLabel("instagram")).toBe("Instagram")
    expect(channelLabel("messenger")).toBe("Messenger")
  })

  it("devuelve el valor crudo si el canal no se reconoce", () => {
    expect(channelLabel("telegram")).toBe("telegram")
  })

  it("usa un fallback para null/undefined/vacío", () => {
    expect(channelLabel(null)).toBe("Canal desconocido")
    expect(channelLabel(undefined)).toBe("Canal desconocido")
    expect(channelLabel("")).toBe("Canal desconocido")
  })
})

describe("hilo de un contacto por número", () => {
  const cuenta = "11111111-1111-4111-8111-111111111111"

  it("el link al chat lleva el número por el que escribió el cliente", () => {
    expect(contactThreadHref({ end_user_id: "u1", channel_account_id: cuenta }))
      .toBe(`/admin/inbox/c/u1?cuenta=${cuenta}`)
  })

  it("sin número (ai-api vieja o canal web) linkea al contacto a secas", () => {
    expect(contactThreadHref({ end_user_id: "u1", channel_account_id: null })).toBe("/admin/inbox/c/u1")
    expect(contactThreadHref({ end_user_id: "u1" })).toBe("/admin/inbox/c/u1")
  })

  it("el mismo contacto en dos números da dos keys distintas", () => {
    expect(contactRowKey({ end_user_id: "u1", channel_account_id: cuenta }))
      .not.toBe(contactRowKey({ end_user_id: "u1", channel_account_id: "otra" }))
  })
})

describe("sendReply con cita", () => {
  it("manda reply_to_message_id y devuelve invalid_reply_to si ai-api lo rechaza", async () => {
    vi.stubEnv("STAFF_TOKEN_SECRET", "x".repeat(40))
    const bodies: unknown[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string))
      return new Response(JSON.stringify({ error: "invalid_reply_to" }), { status: 400 })
    }))
    const r = await sendReply("http://ai.test", "ai-a", "conv-1", "hola", "citado-1")
    expect(bodies[0]).toEqual({ text: "hola", reply_to_message_id: "citado-1" })
    expect(r).toEqual({ ok: false, error: "invalid_reply_to" })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})
