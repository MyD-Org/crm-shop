import { describe, expect, it, vi } from "vitest"
import { sugerirCorreccion, validarDestinatarios } from "./correo-validacion"

describe("sugerirCorreccion", () => {
  it.each([
    ["ana@gmail.com.ar", "ana@gmail.com"],
    ["ana@gmial.com", "ana@gmail.com"],
    ["ana@gmai.com", "ana@gmail.com"],
    ["ana@gmail.co", "ana@gmail.com"],
    ["ana@hotmal.com", "ana@hotmail.com"],
    ["ana@hotmial.com", "ana@hotmail.com"],
    ["ana@outlok.com", "ana@outlook.com"],
    ["Ana <Ana@GMIAL.com>", "ana@gmail.com"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(sugerirCorreccion(entrada)).toBe(esperado)
  })
  it("no corrige dominios válidos", () => {
    expect(sugerirCorreccion("ana@yahoo.com.ar")).toBeNull()
    expect(sugerirCorreccion("ana@gmail.com")).toBeNull()
    expect(sugerirCorreccion("ana@cliente.example")).toBeNull()
    expect(sugerirCorreccion("sin-arroba")).toBeNull()
  })
})

describe("validarDestinatarios", () => {
  it("sugiere el typo sin consultar DNS", async () => {
    const mx = vi.fn()
    const r = await validarDestinatarios(["ana@gmial.com"], mx)
    expect(r).toEqual({ ok: false, error: "¿Quiso decir ana@gmail.com?", sugerencia: "ana@gmail.com" })
    expect(mx).not.toHaveBeenCalled()
  })
  it("rechaza dominio sin correo", async () => {
    const mx = vi.fn(async (d: string) => d !== "nada.example")
    const r = await validarDestinatarios(["a@ok.example", "b@nada.example"], mx)
    expect(r).toEqual({ ok: false, error: "El dominio nada.example no recibe correo. Revise la dirección." })
  })
  it("consulta cada dominio una sola vez", async () => {
    const mx = vi.fn(async () => true)
    const r = await validarDestinatarios(["a@x.example", "Ana <b@X.example>", "c@y.example"], mx)
    expect(r).toEqual({ ok: true })
    expect(mx).toHaveBeenCalledTimes(2)
  })
})
