import { describe, it, expect } from "vitest"
import { EMOJIS, insertAt } from "./EmojiPicker"

describe("insertAt", () => {
  it("inserta en el cursor y deja el cursor después del emoji", () => {
    expect(insertAt("hola mundo", "👋", { start: 4, end: 4 })).toEqual({ text: "hola👋 mundo", cursor: 6 })
  })

  it("reemplaza lo seleccionado", () => {
    expect(insertAt("hola mundo", "🙂", { start: 5, end: 10 })).toEqual({ text: "hola 🙂", cursor: 7 })
  })

  it("sin cursor agrega al final", () => {
    expect(insertAt("gracias", "🙏", null)).toEqual({ text: "gracias🙏", cursor: 9 })
  })
})

describe("EMOJIS", () => {
  it("no tiene repetidos", () => {
    expect(new Set(EMOJIS).size).toBe(EMOJIS.length)
  })
})
