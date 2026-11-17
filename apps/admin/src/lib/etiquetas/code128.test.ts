import { describe, expect, it } from "vitest"
import { barras, checksumCode128, code128b, MENSAJES_REFERENCIA, validarReferencia } from "./code128"

// Salida de `code128b()` de scripts/etiquetas/tspl.ts para las mismas entradas.
const GOLDEN: Record<string, string> = {
  "LED-A60-9W": "2112141321311321131123131221321113232231121231221221323211223113212231122331112",
  ABC123: "2112141113231311231313211232212232112211321411222331112",
  X: "2112143311213121132331112",
}

describe("code128b", () => {
  it.each(Object.entries(GOLDEN))("coincide con el script viejo para %s", (ref, esperado) => {
    expect(code128b(ref)).toBe(esperado)
  })

  it("empieza con el inicio B y termina con stop", () => {
    const p = code128b("LED-A60-9W")
    expect(p.startsWith("211214")).toBe(true)
    expect(p.endsWith("2331112")).toBe(true)
  })

  it("checksum módulo 103 (inicio B + 'PJJ123C')", () => {
    // 104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7 = 879; 879 % 103 = 55.
    const valores = [104, ..."PJJ123C".split("").map((c) => c.charCodeAt(0) - 32)]
    expect(checksumCode128(valores)).toBe(55)
  })

  it("lanza con mensaje en usted ante una referencia inválida", () => {
    expect(() => code128b("ÑANDÚ-1")).toThrow(MENSAJES_REFERENCIA.caracteres)
  })
})

describe("validarReferencia", () => {
  it.each([null, undefined, "", "   "])("vacía o nula (%s)", (code) => {
    expect(validarReferencia(code)).toEqual({ ok: false, mensaje: "El producto no tiene referencia." })
  })

  it("rechaza caracteres fuera de ASCII 32-126", () => {
    expect(validarReferencia("ÑANDÚ-1")).toEqual({
      ok: false,
      mensaje: "La referencia contiene caracteres que no se pueden imprimir en código de barras.",
    })
  })

  it("rechaza más de 18 caracteres indicando el máximo", () => {
    const r = validarReferencia("A".repeat(19))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toContain("18 caracteres")
    expect(validarReferencia("A".repeat(18))).toEqual({ ok: true })
  })
})

describe("barras", () => {
  it("emite un BAR por barra y suma el ancho en módulos", () => {
    const { comandos, ancho } = barras("2112", 10, 46, 64)
    expect(comandos).toEqual(["BAR 10,46,2,64", "BAR 13,46,1,64"])
    expect(ancho).toBe(6)
  })
})
