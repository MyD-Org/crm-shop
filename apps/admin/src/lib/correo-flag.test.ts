import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ valor: true as boolean | "falla" }))

vi.mock("@/lib/flags", () => ({
  correoFlag: async () => {
    if (state.valor === "falla") throw new Error("Vercel Flags no responde")
    return state.valor
  },
}))

import { correoHabilitado } from "./correo-flag"

describe("correoHabilitado", () => {
  beforeEach(() => {
    state.valor = true
  })

  it("refleja el flag de Vercel Flags", async () => {
    expect(await correoHabilitado()).toBe(true)
    state.valor = false
    expect(await correoHabilitado()).toBe(false)
  })

  it("falla cerrado: si Vercel Flags falla, el correo queda apagado", async () => {
    state.valor = "falla"
    expect(await correoHabilitado()).toBe(false)
  })

  it("solo un true estricto lo prende", async () => {
    state.valor = "si" as unknown as boolean
    expect(await correoHabilitado()).toBe(false)
  })
})
