import { describe, expect, it } from "vitest"
import { CHAT_VACIO_MAX, SUGERENCIA_MAX, parseChatTienda } from "./chat-tienda"

describe("parseChatTienda", () => {
  it("vacío ⇒ válido y vacío (el Shop usa sus textos por defecto)", () => {
    expect(parseChatTienda({})).toEqual({ ok: true, value: { emptyState: "", suggestions: [] } })
    expect(parseChatTienda({ emptyState: "  ", suggestions: ["", "  "] })).toEqual({
      ok: true,
      value: { emptyState: "", suggestions: [] },
    })
  })

  it("recorta espacios, descarta vacías y junta repetidas", () => {
    const r = parseChatTienda({
      emptyState: "  Consultas   sobre productos ",
      suggestions: [" Reflectores para exterior", "", "Reflectores  para exterior", "Estado de un pedido"],
    })
    expect(r).toEqual({
      ok: true,
      value: { emptyState: "Consultas sobre productos", suggestions: ["Reflectores para exterior", "Estado de un pedido"] },
    })
  })

  it("rechaza más de 4 preguntas y textos largos", () => {
    expect(parseChatTienda({ suggestions: ["a", "b", "c", "d", "e"] }).ok).toBe(false)
    expect(parseChatTienda({ suggestions: ["x".repeat(SUGERENCIA_MAX + 1)] }).ok).toBe(false)
    expect(parseChatTienda({ emptyState: "x".repeat(CHAT_VACIO_MAX + 1) }).ok).toBe(false)
    expect(parseChatTienda({ suggestions: ["a", "b", "c", "d"] }).ok).toBe(true)
  })

  it("rechaza tipos inválidos", () => {
    expect(parseChatTienda({ emptyState: 3 }).ok).toBe(false)
    expect(parseChatTienda({ suggestions: "hola" }).ok).toBe(false)
    expect(parseChatTienda({ suggestions: [1] }).ok).toBe(false)
  })

  it("errores en usted, sin voseo", () => {
    const r = parseChatTienda({ suggestions: ["a", "b", "c", "d", "e"] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^Indique/)
  })
})
