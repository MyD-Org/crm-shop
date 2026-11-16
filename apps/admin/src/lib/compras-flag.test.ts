import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  compras: true as boolean | "falla",
  recepcion: true as boolean | "falla",
}))

vi.mock("@/lib/flags", () => ({
  comprasEnTransitoFlag: async () => {
    if (state.compras === "falla") throw new Error("Vercel Flags no responde")
    return state.compras
  },
  comprasRecepcionFlag: async () => {
    if (state.recepcion === "falla") throw new Error("Vercel Flags no responde")
    return state.recepcion
  },
}))

import { comprasHabilitado, comprasRecepcionHabilitada } from "./compras-flag"

describe("comprasHabilitado", () => {
  beforeEach(() => {
    state.compras = true
    state.recepcion = true
  })

  it("refleja el flag compras-en-transito", async () => {
    expect(await comprasHabilitado()).toBe(true)
    state.compras = false
    expect(await comprasHabilitado()).toBe(false)
  })

  it("falla cerrado: si Vercel Flags falla, el módulo queda apagado", async () => {
    state.compras = "falla"
    expect(await comprasHabilitado()).toBe(false)
  })

  it("sólo un true estricto lo prende", async () => {
    state.compras = "si" as unknown as boolean
    expect(await comprasHabilitado()).toBe(false)
  })
})

describe("comprasRecepcionHabilitada", () => {
  beforeEach(() => {
    state.compras = true
    state.recepcion = true
  })

  it("exige los DOS flags: sin el módulo no hay recepción", async () => {
    expect(await comprasRecepcionHabilitada()).toBe(true)
    state.compras = false
    expect(await comprasRecepcionHabilitada()).toBe(false)
  })

  it("con el módulo prendido, depende de compras-recepcion", async () => {
    state.recepcion = false
    expect(await comprasRecepcionHabilitada()).toBe(false)
  })

  it("falla cerrado ante cualquier error del SDK", async () => {
    state.recepcion = "falla"
    expect(await comprasRecepcionHabilitada()).toBe(false)
    state.recepcion = true
    state.compras = "falla"
    expect(await comprasRecepcionHabilitada()).toBe(false)
  })
})
