import { describe, expect, it } from "vitest"
import fixture from "./__fixtures__/tema-contrato.json"
import {
  UMBRAL_CONTRASTE,
  contrasteTema,
  marcaSobreOscuro,
  razonDeContraste,
  validarContrasteTema,
} from "./tema-contraste"
import type { ColoresTema } from "./tienda-online"

const paletas = fixture.paletas as Record<string, ColoresTema>

describe("razonDeContraste (WCAG 2.x)", () => {
  it.each(fixture.razones)("$a sobre $b = $ratio", ({ a, b, ratio }) => {
    expect(razonDeContraste(a, b)).toBeCloseTo(ratio, 1)
  })

  it("es simétrica", () => {
    expect(razonDeContraste("#1e5aa8", "#ffffff")).toBeCloseTo(razonDeContraste("#ffffff", "#1e5aa8"), 10)
  })

  it("el umbral es AA para texto normal", () => {
    expect(UMBRAL_CONTRASTE).toBe(4.5)
  })
})

describe("marcaSobreOscuro", () => {
  it("aclara el acento (mezcla con blanco) y devuelve un hex", () => {
    const m = marcaSobreOscuro("#1e5aa8")
    expect(m).toMatch(/^#[0-9a-f]{6}$/)
    expect(razonDeContraste(m, "#1c2733")).toBeGreaterThan(razonDeContraste("#1e5aa8", "#1c2733"))
  })
})

describe("validarContrasteTema (fixture tema-contrato.json)", () => {
  it.each(fixture.contraste)("$nombre", ({ paleta, cambios, ok, campo }) => {
    const colores = { ...paletas[paleta], ...cambios } as ColoresTema
    const r = validarContrasteTema(colores)
    expect(r.ok).toBe(ok)
    if (!r.ok) {
      expect(r.campo).toBe(campo)
      expect(r.razon).toBeLessThan(UMBRAL_CONTRASTE)
      // Error en usted, listo para mostrar en pantalla.
      expect(r.error).not.toMatch(/\b(tu|tus|te|vos|ingresá|probá)\b/i)
      expect(r.error.length).toBeGreaterThan(20)
    }
  })

  it("contrasteTema devuelve las cuatro razones que se validan", () => {
    const c = contrasteTema(paletas["calido-azul"])
    expect(c.map((x) => x.campo)).toEqual(["text", "onPrimary", "accent", "surfaceDark"])
    for (const x of c) expect(x.razon).toBeGreaterThanOrEqual(UMBRAL_CONTRASTE)
  })
})
