import { describe, expect, it } from "vitest"
import { agruparLineas, extraerItemsPaginas, extraerTextoPaginas, PdfIlegible, textoDeItems, tieneTexto } from "./catalogo-ficha-texto"
import { crearPdfDePrueba, crearPdfPosicionado } from "./pdf-de-prueba"

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
    await expect(extraerItemsPaginas(new TextEncoder().encode("esto no es un pdf"))).rejects.toBeInstanceOf(PdfIlegible)
  })
})

describe("extraerItemsPaginas / agruparLineas", () => {
  it("devuelve cada texto con su posición y las líneas salen agrupadas por y", async () => {
    const bytes = await crearPdfPosicionado([
      [
        { t: "Modelo", x: 40, y: 700 },
        { t: "RF-10", x: 150, y: 700 },
        { t: "RF-20", x: 250, y: 701 },
        { t: "Potencia", x: 40, y: 680 },
        { t: "10W", x: 150, y: 680 },
        { t: "20W", x: 250, y: 680 },
      ],
    ])
    const [items] = await extraerItemsPaginas(bytes)
    const rf20 = items.find((i) => i.str === "RF-20")!
    expect(Math.round(rf20.x)).toBe(250)
    expect(Math.round(rf20.y)).toBe(701)
    const lineas = agruparLineas(items)
    expect(lineas.map((l) => l.map((i) => i.str))).toEqual([
      ["Modelo", "RF-10", "RF-20"],
      ["Potencia", "10W", "20W"],
    ])
    expect(textoDeItems(items)).toBe("Modelo RF-10 RF-20\nPotencia 10W 20W")
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
