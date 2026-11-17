import { describe, expect, it } from "vitest"
import { cabeceraTspl, comandoBitmap, rgbaA1bit } from "./bitmap"

function imagen(pixeles: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixeles.flat())
}
const NEGRO: [number, number, number, number] = [0, 0, 0, 255]
const BLANCO: [number, number, number, number] = [255, 255, 255, 255]

describe("rgbaA1bit", () => {
  it("4 negros + 4 blancos -> 0x0F", () => {
    const { bytes, anchoBytes } = rgbaA1bit(imagen([NEGRO, NEGRO, NEGRO, NEGRO, BLANCO, BLANCO, BLANCO, BLANCO]), 8, 1)
    expect(anchoBytes).toBe(1)
    expect([...bytes]).toEqual([0x0f])
  })

  it("ancho 10 -> 2 bytes por fila con los bits sobrantes en 1", () => {
    const { bytes, anchoBytes } = rgbaA1bit(imagen(Array(10).fill(NEGRO)), 10, 1)
    expect(anchoBytes).toBe(2)
    expect([...bytes]).toEqual([0x00, 0x3f])
  })

  it("transparente (0,0,0,0) se trata como blanco", () => {
    const { bytes } = rgbaA1bit(imagen([[0, 0, 0, 0], ...Array(7).fill(BLANCO)]), 8, 1)
    expect([...bytes]).toEqual([0xff])
  })

  it("umbral de luminancia 128", () => {
    const { bytes } = rgbaA1bit(imagen([[127, 127, 127, 255], [128, 128, 128, 255], ...Array(6).fill(BLANCO)]), 8, 1)
    expect([...bytes]).toEqual([0x7f])
  })

  it("varias filas", () => {
    const { bytes } = rgbaA1bit(imagen([NEGRO, BLANCO, BLANCO, NEGRO]), 2, 2)
    expect([...bytes]).toEqual([0x7f, 0xbf])
  })
})

describe("comandoBitmap y cabecera", () => {
  it("BITMAP x,y,wb,h,0, seguido de los bytes crudos", () => {
    const datos = comandoBitmap(0, 0, 2, 1, new Uint8Array([0x00, 0x3f]))
    const prefijo = new TextEncoder().encode("BITMAP 0,0,2,1,0,")
    expect([...datos.slice(0, prefijo.length)]).toEqual([...prefijo])
    expect([...datos.slice(prefijo.length)]).toEqual([0x00, 0x3f])
  })

  it("rechaza bytes de tamaño incorrecto", () => {
    expect(() => comandoBitmap(0, 0, 2, 2, new Uint8Array(3))).toThrow()
  })

  it("cabecera con y sin densidad", () => {
    expect(cabeceraTspl({ anchoMm: 100, altoMm: 150, gapMm: 3, densidad: 10 })).toBe(
      "SIZE 100 mm,150 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0\r\nREFERENCE 0,0\r\nDENSITY 10\r\n",
    )
    expect(cabeceraTspl({ anchoMm: 100, altoMm: 20, gapMm: 2 })).not.toContain("DENSITY")
  })
})
