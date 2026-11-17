import { describe, expect, it } from "vitest"
import { ajustarTexto, moduloQr } from "./canvas"
import { primeraFilaTspl, trabajoCodigos, trabajoQr6, type HojaQr, type ItemEtiqueta } from "./trabajos"

const texto = (d: Uint8Array) => new TextDecoder("latin1").decode(d)
const item = (alegraId: string, cantidad = 1, referencia: string | null = "R" + alegraId): ItemEtiqueta => ({
  alegraId,
  referencia,
  nombre: "Producto " + alegraId,
  cantidad,
})

/** Doble del canvas: hoja blanca de 800x1200 con un píxel negro arriba a la izquierda. */
const dibujarBlanco = async () => {
  const data = new Uint8ClampedArray(800 * 1200 * 4).fill(255)
  data[0] = data[1] = data[2] = 0
  return { data, width: 800, height: 1200 }
}

describe("trabajoQr6", () => {
  it("7 productos = 2 trabajos (uno por hoja) con SIZE 100x150, GAP 3, DENSITY 10 y un PRINT 1,1", async () => {
    const hojas: HojaQr[] = []
    const r = await trabajoQr6(
      Array.from({ length: 7 }, (_, i) => item(String(i + 1))),
      "https://tienda.cliente.example/",
      async (h) => {
        hojas.push(h)
        return dibujarBlanco()
      },
    )
    if (!r.ok) throw new Error(r.mensaje)
    expect(r.etiquetas).toBe(7)
    expect(r.trabajos.map((t) => t.etiquetas)).toEqual([6, 1])
    expect(hojas[1].celdas.filter((c) => c === null)).toHaveLength(5)
    const s = texto(r.trabajos[0].datos)
    expect(s.startsWith("SIZE 100 mm,150 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0\r\nREFERENCE 0,0\r\nDENSITY 10\r\nCLS\r\nBITMAP 0,0,100,1200,0,")).toBe(true)
    expect(s.match(/PRINT 1,1/g)).toHaveLength(1)
    // 100 bytes x 1200 filas de bitmap: el primer byte lleva el píxel negro (bit 0).
    const inicio = s.indexOf("BITMAP 0,0,100,1200,0,") + "BITMAP 0,0,100,1200,0,".length
    expect(r.trabajos[0].datos[inicio]).toBe(0x7f)
    expect(r.trabajos[0].datos.length).toBe(inicio + 100 * 1200 + "\r\nPRINT 1,1\r\n".length)
  })

  it("cada unidad de cantidad es una celda y la URL del QR lleva el alegraId codificado", async () => {
    const hojas: HojaQr[] = []
    const r = await trabajoQr6([item("mdp:12", 2)], "https://tienda.cliente.example", async (h) => {
      hojas.push(h)
      return dibujarBlanco()
    })
    expect(r.ok && r.etiquetas).toBe(2)
    expect(hojas[0].celdas[1]?.url).toBe("https://tienda.cliente.example/producto/mdp%3A12")
    expect(hojas[0].celdas[0]?.web).toBe("tienda.cliente.example")
  })

  it("sin dirección web de la tienda no dibuja nada y devuelve el mensaje", async () => {
    let llamadas = 0
    const r = await trabajoQr6([item("1")], null, async () => {
      llamadas++
      return dibujarBlanco()
    })
    expect(r).toEqual({ ok: false, mensaje: "No se puede armar el código QR porque la tienda no tiene dirección web." })
    expect(llamadas).toBe(0)
  })
})

describe("ajustarTexto (nombre de la celda QR)", () => {
  // Medidor simulado: cada carácter mide la mitad del tamaño de fuente.
  const medir = (t: string, px: number) => t.length * px * 0.5

  it("si entra a 25 px queda igual", () => {
    expect(ajustarTexto("Lámpara LED 9W", 360, 25, 18, medir)).toEqual({ texto: "Lámpara LED 9W", px: 25 })
  })

  it("si no entra, baja la fuente hasta que entre", () => {
    const t = "x".repeat(32) // 32 * 12.5 = 400 a 25 px; 32 * 11 = 352 a 22 px
    expect(ajustarTexto(t, 360, 25, 18, medir)).toEqual({ texto: t, px: 22 })
  })

  it("si ni a la mínima entra, corta con elipsis dentro del ancho", () => {
    const r = ajustarTexto("y".repeat(80), 360, 25, 18, medir)
    expect(r.px).toBe(18)
    expect(r.texto.endsWith("…")).toBe(true)
    expect(medir(r.texto, 18)).toBeLessThanOrEqual(360)
    expect(medir(r.texto + "y", 18)).toBeGreaterThan(360)
  })
})

describe("moduloQr", () => {
  it("módulos enteros que no pasan de 250 px", () => {
    expect(moduloQr(25, 250)).toBe(10)
    expect(moduloQr(29, 250)).toBe(8)
    expect(moduloQr(300, 250)).toBe(1)
  })
})

describe("primeraFilaTspl (vista previa 29x20)", () => {
  it("lee los BAR y TEXT de la primera fila del trabajo real, no los de las siguientes", () => {
    const r = trabajoCodigos([item("1", 4)])
    const fila = primeraFilaTspl(texto(r.trabajos[0].datos))
    expect(fila.textos.map((t) => t.texto)).toEqual(["Producto 1", "R1", "Producto 1", "R1", "Producto 1", "R1"])
    expect(fila.barras.length).toBeGreaterThan(0)
    expect(fila.barras.every((b) => b.alto === 64 && b.y === 46)).toBe(true)
    expect(Math.min(...fila.barras.map((b) => b.x))).toBeGreaterThanOrEqual(16)
  })
})
