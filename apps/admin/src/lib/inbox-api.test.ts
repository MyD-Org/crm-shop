import { describe, it, expect } from "vitest"
import { channelLabel, contactRowKey, contactThreadHref } from "./inbox-api"

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
