import { describe, expect, it } from "vitest"
import { extraerTextoPaginas, PdfIlegible, tieneTexto } from "./catalogo-ficha-texto"
import { crearPdfDePrueba } from "./pdf-de-prueba"

describe("extraerTextoPaginas", () => {
  it("devuelve el texto por página, en orden físico", async () => {
    const bytes = await crearPdfDePrueba([["Pagina uno", "Modelo RF-10 10W"], ["Pagina dos"], ["Pagina tres"]])
    const r = await extraerTextoPaginas(bytes)
    expect(r.total).toBe(3)
    expect(r.paginas[0]).toContain("Modelo RF-10 10W")
    expect(r.paginas[1]).toContain("Pagina dos")
    expect(r.paginas[2]).toContain("Pagina tres")
  })

  it("página sin texto => cadena vacía", async () => {
    const r = await extraerTextoPaginas(await crearPdfDePrueba([["Hola"], []]))
    expect(r.paginas[1].trim()).toBe("")
  })

  it("PDF corrupto => PdfIlegible", async () => {
    await expect(extraerTextoPaginas(new TextEncoder().encode("esto no es un pdf"))).rejects.toBeInstanceOf(PdfIlegible)
  })
})

describe("tieneTexto", () => {
  it("promedio de caracteres útiles por página", () => {
    expect(tieneTexto([])).toBe(false)
    expect(tieneTexto(["", "  "])).toBe(false)
    expect(tieneTexto(["x".repeat(60)])).toBe(true)
    expect(tieneTexto(["x".repeat(60), ""])).toBe(false)
  })
})
