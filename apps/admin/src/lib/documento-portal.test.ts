import { describe, expect, it } from "vitest"
import { normalizarDocumento } from "./documento-portal"

describe("normalizarDocumento", () => {
  it("CUIT y DNI en los formatos habituales, a solo dígitos", () => {
    expect(normalizarDocumento("20-12345678-9")).toBe("20123456789")
    expect(normalizarDocumento(" 20123456789 ")).toBe("20123456789")
    expect(normalizarDocumento("20.123.456.789")).toBe("20123456789")
    expect(normalizarDocumento("12.345.678")).toBe("12345678")
    expect(normalizarDocumento("1234567")).toBe("1234567")
  })

  it("rechaza lo que no es un documento", () => {
    for (const malo of ["", "compras@cliente.example", "ACME SRL", "20-1234x678-9", "12345", "123456789012"]) {
      expect(normalizarDocumento(malo), malo).toBeNull()
    }
  })
})
