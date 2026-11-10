import { describe, it, expect } from "vitest"
import { bubbleDomId, canQuote, quoteAuthorLabel, quoteExcerpt, quoteFromMessage } from "./message-quote"

describe("quoteAuthorLabel", () => {
  it("nombra al autor del mensaje citado", () => {
    expect(quoteAuthorLabel("customer")).toBe("Cliente")
    expect(quoteAuthorLabel("bot")).toBe("Bot")
    expect(quoteAuthorLabel("human")).toBe("Operador")
    expect(quoteAuthorLabel(null)).toBe("Mensaje")
  })
})

describe("quoteExcerpt", () => {
  it("aplana saltos de línea y recorta con puntos suspensivos", () => {
    expect(quoteExcerpt("hola\n\nmundo")).toBe("hola mundo")
    const largo = quoteExcerpt("a".repeat(200))
    expect(largo).toHaveLength(140)
    expect(largo.endsWith("…")).toBe(true)
  })

  it("un adjunto citado se lee como ícono y etiqueta, no con la marca del bot", () => {
    expect(quoteExcerpt("[El cliente envió una imagen]")).toBe("📷 Imagen")
    expect(quoteExcerpt("[El cliente envió una imagen]\nla del medio")).toBe("📷 la del medio")
  })

  it("un texto del cliente entre corchetes en una línea suelta queda como vino si no es marca", () => {
    expect(quoteExcerpt("precio [con IVA]")).toBe("precio [con IVA]")
  })
})

describe("citar desde el hilo", () => {
  it("la burbuja optimista no se puede citar hasta tener id real", () => {
    expect(canQuote({ id: "temp-123-abc", pending: true })).toBe(false)
    expect(canQuote({ id: "temp-123-abc" })).toBe(false)
    expect(canQuote({ id: "11111111-1111-4111-8111-111111111111" })).toBe(true)
  })

  it("arma la cita optimista con extracto y autor", () => {
    expect(quoteFromMessage({ id: "m1", text: "¿tienen el B?", source: "customer" }))
      .toEqual({ id: "m1", text: "¿tienen el B?", source: "customer" })
  })

  it("id estable de la burbuja en el DOM", () => {
    expect(bubbleDomId("m1")).toBe("msg-m1")
  })
})
