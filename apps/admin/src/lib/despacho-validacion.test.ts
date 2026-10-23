import { describe, it, expect } from "vitest"
import { DESPACHO_DEFAULT, MSG_DIAS, plazoDespacho, textoPreview, validarDespacho } from "./despacho-validacion"

describe("validarDespacho", () => {
  it("acepta visible y días como número o texto", () => {
    expect(validarDespacho({ visible: true, diasHabiles: 3 })).toEqual({ ok: true, despacho: { visible: true, diasHabiles: 3 } })
    expect(validarDespacho({ visible: false, diasHabiles: " 2 " })).toEqual({ ok: true, despacho: { visible: false, diasHabiles: 2 } })
  })

  it("los días van de 1 a 30 y enteros, aunque el plazo esté oculto", () => {
    for (const dias of [0, 31, 1.5, "1,5", "", "x", null, undefined, -1]) {
      expect(validarDespacho({ visible: false, diasHabiles: dias })).toEqual({ ok: false, campo: "diasHabiles", error: MSG_DIAS })
    }
    expect(validarDespacho({ visible: true, diasHabiles: 1 }).ok).toBe(true)
    expect(validarDespacho({ visible: true, diasHabiles: 30 }).ok).toBe(true)
  })

  it("visible tiene que ser booleano y el cuerpo un objeto", () => {
    expect(validarDespacho({ visible: "si", diasHabiles: 1 })).toMatchObject({ ok: false, campo: "visible" })
    expect(validarDespacho(null)).toMatchObject({ ok: false, campo: "body" })
    expect(validarDespacho([])).toMatchObject({ ok: false, campo: "body" })
  })

  it("el default reproduce lo que el Shop mostraba antes: visible, 24 h hábiles", () => {
    expect(DESPACHO_DEFAULT).toEqual({ visible: true, diasHabiles: 1 })
    expect(textoPreview(DESPACHO_DEFAULT).conStock).toBe("Despacho dentro de las 24 h hábiles.")
  })
})

describe("textos para el cliente", () => {
  it("1 día se dice 24 h hábiles; más, en días hábiles", () => {
    expect(plazoDespacho(1)).toBe("dentro de las 24 h hábiles")
    expect(plazoDespacho(3)).toBe("dentro de 3 días hábiles")
  })

  it("la vista previa explica la suma de la demora y el caso oculto", () => {
    expect(textoPreview({ visible: true, diasHabiles: 1 }).aTraer).toContain("1 día hábil más")
    expect(textoPreview({ visible: true, diasHabiles: 2 }).aTraer).toContain("2 días hábiles más")
    expect(textoPreview({ visible: false, diasHabiles: 5 }).conStock).toBe("Disponible (sin plazo de despacho).")
  })
})
