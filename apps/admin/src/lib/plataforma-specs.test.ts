import { describe, it, expect, vi } from "vitest"
import { sincronizarSpecs, SPECS_PROYECTADAS } from "./plataforma-specs"
import type { TenantConfig } from "./tenants"

const t = { id: "central-led", plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s" } as TenantConfig

describe("sincronizarSpecs", () => {
  it("lee cada spec proyectado y lo guarda con su versión", async () => {
    const doc = { slug: "atributos_tecnicos", version: 3, fields: [] }
    const leer = vi.fn(async () => doc)
    const guardar = vi.fn(async () => "escrita" as const)
    const r = await sincronizarSpecs(t, { leerSpec: leer, guardarSpec: guardar })
    expect(leer).toHaveBeenCalledWith(t, "atributos_tecnicos")
    expect(guardar).toHaveBeenCalledWith("central-led", "atributos_tecnicos", 3, doc)
    expect(r).toEqual(SPECS_PROYECTADAS.map((slug) => ({ slug, resultado: "escrita", version: 3 })))
  })
  it("informa 'vieja' cuando el guardado rechaza una versión menor", async () => {
    const r = await sincronizarSpecs(t, { leerSpec: async () => ({ version: 1 }), guardarSpec: async () => "vieja" })
    expect(r[0]).toMatchObject({ resultado: "vieja", version: 1 })
  })
  it("documento sin version numérica → invalida, sin guardar", async () => {
    const guardar = vi.fn()
    const r = await sincronizarSpecs(t, { leerSpec: async () => ({ slug: "x" }), guardarSpec: guardar })
    expect(r[0].resultado).toBe("invalida")
    expect(guardar).not.toHaveBeenCalled()
  })
  it("un error de la plataforma se informa y no tira", async () => {
    const r = await sincronizarSpecs(t, { leerSpec: async () => { throw new Error("plataforma 503") }, guardarSpec: vi.fn() })
    expect(r[0]).toMatchObject({ resultado: "error", error: "plataforma 503" })
  })
})
