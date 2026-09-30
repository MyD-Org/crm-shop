import { describe, expect, it } from "vitest"
import * as ayudas from "./ayudas"

// Los textos de ayuda son copy del producto: van en usted / impersonal (CLAUDE.md) y entran en el
// tooltip del DS (16rem de ancho), así que no pueden ser párrafos.
describe("textos de ayuda del catálogo", () => {
  const textos = Object.entries(ayudas).filter(([, v]) => typeof v === "string") as [string, string][]

  it("hay textos y todos terminan en punto", () => {
    expect(textos.length).toBeGreaterThan(0)
    for (const [clave, t] of textos) expect(t.trim().endsWith("."), clave).toBe(true)
  })

  it("no usan voseo ni tuteo", () => {
    const informal = /\b(vos|tu|tus|te|tenés|podés|querés|usá|elegí|hacé|mirá)\b/i
    for (const [clave, t] of textos) expect(informal.test(t), clave).toBe(false)
  })

  it("son breves: como mucho 260 caracteres", () => {
    for (const [clave, t] of textos) expect(t.length, clave).toBeLessThanOrEqual(260)
  })
})
