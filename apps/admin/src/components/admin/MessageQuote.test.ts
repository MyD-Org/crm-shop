import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QuoteBlock, ReplyButton, ReplyingToBar } from "./MessageQuote"

// Render estático (sin DOM): alcanza para fijar qué ve el operador en la cita.

describe("QuoteBlock", () => {
  it("muestra el autor y el extracto, y avisa adónde lleva", () => {
    const html = renderToStaticMarkup(createElement(QuoteBlock, {
      quote: { id: "m1", text: "Tenemos el modelo A y el B.", source: "bot" }, outbound: false,
    }))
    expect(html).toContain(">Bot<")
    expect(html).toContain("Tenemos el modelo A y el B.")
    expect(html).toContain('title="Ir al mensaje citado"')
  })

  it("un adjunto citado se lee con ícono, sin la marca del bot", () => {
    const html = renderToStaticMarkup(createElement(QuoteBlock, {
      quote: { id: "m1", text: "[El cliente envió una imagen]", source: "customer" }, outbound: true,
    }))
    expect(html).toContain(">Cliente<")
    expect(html).toContain("📷 Imagen")
    expect(html).not.toContain("El cliente envió")
  })
})

describe("ReplyingToBar", () => {
  it("dice a quién se responde y ofrece cancelar la cita", () => {
    const html = renderToStaticMarkup(createElement(ReplyingToBar, {
      quote: { id: "m1", text: "¿tienen el B?", source: "customer" }, onCancel: () => {},
    }))
    expect(html).toContain("Respondiendo a cliente")
    expect(html).toContain("¿tienen el B?")
    expect(html).toContain('aria-label="Cancelar respuesta citada"')
  })
})

describe("ReplyButton", () => {
  it("tiene nombre accesible en usted", () => {
    const html = renderToStaticMarkup(createElement(ReplyButton, { onClick: () => {} }))
    expect(html).toContain('aria-label="Responder a este mensaje"')
  })
})
