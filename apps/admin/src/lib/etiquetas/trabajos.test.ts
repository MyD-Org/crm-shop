import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CABECERA_100X150, codigoDeBarras, ensamblarTrabajoBitmap, trabajoCodigos, type ItemEtiqueta } from "./trabajos"

const texto = (d: Uint8Array) => new TextDecoder().decode(d)
const item = (alegraId: string, referencia: string | null, nombre: string, cantidad = 1): ItemEtiqueta => ({
  alegraId,
  referencia,
  nombre,
  cantidad,
})
const contar = (s: string, linea: string) => s.split("\r\n").filter((l) => l === linea).length

describe("trabajoCodigos (29x20, 3 por fila)", () => {
  it("coincide con scripts/etiquetas/codigos.ts (golden), salvo REFERENCE 0,0", () => {
    // Generado con: codigos.ts sobre [["LED-A60-9W","Lámpara Ñandú LED 9W cálida",1],
    // ["T8-18W","Tubo T8",1],["ZOC-01","Zócalo",2]].
    const golden = readFileSync(new URL("./__fixtures__/codigos-golden.tspl", import.meta.url), "utf8")
    const r = trabajoCodigos([
      item("1", "LED-A60-9W", "Lámpara Ñandú LED 9W cálida"),
      item("2", "T8-18W", "Tubo T8"),
      item("3", "ZOC-01", "Zócalo", 2),
    ])
    expect(r.trabajos).toHaveLength(1)
    expect(texto(r.trabajos[0].datos).replaceAll("REFERENCE 0,0\r\n", "")).toBe(golden)
  })

  it("tres productos x1 = una fila en x = 2, 34 y 66 mm", () => {
    const r = trabajoCodigos([item("1", "A1", "Uno"), item("2", "B2", "Dos"), item("3", "C3", "Tres")])
    const s = texto(r.trabajos[0].datos)
    expect(contar(s, "CLS")).toBe(1)
    expect(contar(s, "PRINT 1,1")).toBe(1)
    const xs = s.split("\r\n").filter((l) => l.startsWith("TEXT") && l.includes(",118,")).map((l) => Number(l.split(/[ ,]/)[1]))
    expect(xs[0]).toBeGreaterThanOrEqual(2 * 8)
    expect(xs[0]).toBeLessThan(31 * 8)
    expect(xs[1]).toBeGreaterThanOrEqual(34 * 8)
    expect(xs[1]).toBeLessThan(63 * 8)
    expect(xs[2]).toBeGreaterThanOrEqual(66 * 8)
    expect(r.etiquetas).toBe(3)
  })

  it("cabecera exacta", () => {
    const s = texto(trabajoCodigos([item("1", "A1", "Uno")]).trabajos[0].datos)
    expect(s.startsWith("SIZE 100 mm,20 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 0\r\nREFERENCE 0,0\r\nCLS\r\n")).toBe(true)
  })

  it("un producto x4 = 2 filas (3 + 1)", () => {
    const s = texto(trabajoCodigos([item("1", "A1", "Uno", 4)]).trabajos[0].datos)
    const filas = s.split("PRINT 1,1\r\n").filter(Boolean)
    expect(filas).toHaveLength(2)
    expect(filas[0].split(',118,"2"').length - 1).toBe(3)
    expect(filas[1].split(',118,"2"').length - 1).toBe(1)
  })

  it("35 etiquetas = 12 filas en 2 tandas (10 y 2 filas)", () => {
    const r = trabajoCodigos([item("1", "A1", "Uno", 35)])
    expect(r.trabajos).toHaveLength(2)
    expect(contar(texto(r.trabajos[0].datos), "PRINT 1,1")).toBe(10)
    expect(contar(texto(r.trabajos[1].datos), "PRINT 1,1")).toBe(2)
    expect(r.trabajos.map((t) => t.etiquetas)).toEqual([30, 5])
    expect(r.etiquetas).toBe(35)
  })

  it("omite productos inválidos con motivo y sigue con los válidos", () => {
    const r = trabajoCodigos([
      item("1", "A1", "Uno"),
      item("2", null, "Sin ref", 3),
      item("3", "ÑANDÚ-1", "Tilde"),
      item("4", "A".repeat(19), "Larga"),
      item("5", "B2", "Cero", 0),
    ])
    expect(r.etiquetas).toBe(1)
    expect(r.omitidos).toEqual([
      { alegraId: "2", nombre: "Sin ref", motivo: "El producto no tiene referencia." },
      {
        alegraId: "3",
        nombre: "Tilde",
        motivo: "La referencia contiene caracteres que no se pueden imprimir en código de barras.",
      },
      { alegraId: "4", nombre: "Larga", motivo: "El código de barras de la referencia no entra en la etiqueta de 29 mm." },
      { alegraId: "5", nombre: "Cero", motivo: "Ingrese una cantidad entera entre 1 y 999." },
    ])
  })

  it("omite una referencia cuyo código no entra en 29 mm", () => {
    // Cada símbolo ocupa 11 módulos: (inicio + 18 + checksum) * 11 + stop 13 = 233 puntos,
    // más que 29 mm - 16 puntos = 216. En la práctica entran hasta 16 caracteres.
    const r = trabajoCodigos([item("1", "W".repeat(18), "Ancho")])
    expect(r.omitidos[0]?.motivo).toBe("El código de barras de la referencia no entra en la etiqueta de 29 mm.")
    expect(r.trabajos).toHaveLength(0)
  })

  it("si la referencia no entra, imprime el código sin el sufijo de marca", () => {
    const r = trabajoCodigos([item("1", "VOLKAN-BLACK-40-GRS", "Volkan")])
    expect(r.omitidos).toEqual([])
    expect(r.etiquetas).toBe(1)
    const s = texto(r.trabajos[0].datos)
    expect(s).toContain('"VOLKAN-BLACK-40"')
    expect(s).not.toContain("VOLKAN-BLACK-40-GRS")
  })

  it("si tampoco entra sin el sufijo, la omite con motivo", () => {
    const r = trabajoCodigos([item("1", "W".repeat(17) + "-GRS", "Ancho")])
    expect(r.omitidos[0]?.motivo).toBe(
      "El código de barras de la referencia no entra en la etiqueta de 29 mm, ni siquiera sin el sufijo.",
    )
  })

  it("trunca el nombre a 18 caracteres", () => {
    const s = texto(trabajoCodigos([item("1", "A1", "Nombre muy largo del producto")]).trabajos[0].datos)
    expect(s).toContain('"Nombre muy largo d"')
  })

  it("lista vacía = sin trabajos", () => {
    expect(trabajoCodigos([])).toEqual({ trabajos: [], omitidos: [], etiquetas: 0 })
  })
})

describe("ensamblarTrabajoBitmap", () => {
  it("una cabecera y CLS + BITMAP + PRINT 1,1 por hoja", () => {
    const img = { bytes: new Uint8Array([0xff, 0x00]), anchoBytes: 1, alto: 2 }
    const datos = ensamblarTrabajoBitmap(CABECERA_100X150, [img, img])
    const s = new TextDecoder("latin1").decode(datos)
    expect(s.startsWith("SIZE 100 mm,150 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0\r\nREFERENCE 0,0\r\nDENSITY 10\r\n")).toBe(true)
    expect(s.split("SIZE").length - 1).toBe(1)
    expect(s.split("BITMAP 0,0,1,2,0,").length - 1).toBe(2)
    expect(s.split("PRINT 1,1").length - 1).toBe(2)
  })
})

describe("codigoDeBarras", () => {
  it("usa la referencia completa cuando entra", () => {
    expect(codigoDeBarras("ARDA-55-GRS")).toMatchObject({ ok: true, codigo: "ARDA-55-GRS", sinSufijo: false })
  })
  it("saca el sufijo cuando la completa no entra", () => {
    expect(codigoDeBarras("VOLKAN-BLACK-40-GRS")).toMatchObject({ ok: true, codigo: "VOLKAN-BLACK-40", sinSufijo: true })
  })
  it("rechaza vacía y caracteres fuera de Code128B", () => {
    expect(codigoDeBarras(null)).toEqual({ ok: false, mensaje: "El producto no tiene referencia." })
    expect(codigoDeBarras("ÑANDÚ-1-GRS").ok).toBe(false)
  })
})
