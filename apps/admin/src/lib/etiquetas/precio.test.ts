import { describe, expect, it } from "vitest"
import { pxQueEntra, textosCeldaPrecio4 } from "./canvas"
import {
  contenidoPrecio,
  formatoPesos,
  layoutPrecio4,
  MENSAJE_PRECIO_ANCHO,
  MENSAJE_SIN_PRECIO,
  primeraFilaTspl,
  renglonPrecio,
  ROLLOS,
  trabajoPrecio4,
  trabajoPrecios,
  type HojaPrecio,
  type ItemEtiqueta,
  type PrecioEtiqueta,
} from "./trabajos"

const texto = (d: Uint8Array) => new TextDecoder("latin1").decode(d)
const item = (alegraId: string, nombre = "Producto " + alegraId, cantidad = 1): ItemEtiqueta => ({
  alegraId,
  referencia: null,
  nombre,
  cantidad,
})
const conMedio = (lista: number, medio: number, rotulo = "con Transferencia"): PrecioEtiqueta => ({
  precioLista: lista,
  precioMedio: { nombre: "Transferencia", rotulo, precio: medio },
})
const soloLista = (lista: number): PrecioEtiqueta => ({ precioLista: lista, precioMedio: null })
const textos = (s: string) => s.split("\r\n").filter((l) => l.startsWith("TEXT"))

describe("formatoPesos", () => {
  it("pesos redondeados con punto de miles, sin espacio ni decimales", () => {
    expect(formatoPesos(41310)).toBe("$41.310")
    expect(formatoPesos(45899.6)).toBe("$45.900")
    expect(formatoPesos(999)).toBe("$999")
    expect(formatoPesos(1234567.4)).toBe("$1.234.567")
    expect(formatoPesos(0.4)).toBe("$0")
  })
})

describe("trabajoPrecios (precio 29x20, 3 por fila)", () => {
  it("golden: una etiqueta con medio destacado (posiciones, fuentes y centrado)", () => {
    const r = trabajoPrecios([item("1", "Lámpara LED 9W")], { "1": conMedio(45900, 41310) })
    expect(r.trabajos).toHaveLength(1)
    expect(texto(r.trabajos[0].datos)).toBe(
      [
        "SIZE 100 mm,20 mm",
        "GAP 2 mm,0 mm",
        "DIRECTION 0",
        "REFERENCE 0,0",
        "CLS",
        // base 16 + (232 - 14*8)/2 = 76
        'TEXT 76,24,"1",0,1,1,"Lampara LED 9W"',
        // 7 caracteres * 32 = 224 → 16 + 4
        'TEXT 20,44,"5",0,1,1,"$41.310"',
        'TEXT 64,96,"1",0,1,1,"con transferencia"',
        'TEXT 54,116,"2",0,1,1,"Lista $45.900"',
        "PRINT 1,1",
        "",
      ].join("\r\n"),
    )
    expect(ROLLOS["precio-29x20"]).toEqual(ROLLOS["codigos-29x20"])
  })

  it("tres por fila en x = 2, 34 y 66 mm y nada por encima de y=24", () => {
    const precios = { "1": conMedio(45900, 41310), "2": conMedio(1000, 900), "3": soloLista(500) }
    const s = texto(trabajoPrecios([item("1"), item("2"), item("3")], precios).trabajos[0].datos)
    const lineas = textos(s)
    const nombres = lineas.filter((l) => l.includes(',24,"1"'))
    const xs = nombres.map((l) => Number(l.split(/[ ,]/)[1]))
    expect(xs[0]).toBeGreaterThanOrEqual(2 * 8)
    expect(xs[1]).toBeGreaterThanOrEqual(34 * 8)
    expect(xs[2]).toBeGreaterThanOrEqual(66 * 8)
    expect(Math.min(...lineas.map((l) => Number(l.split(/[ ,]/)[2])))).toBe(24)
  })

  it("centra cada texto en los 232 puntos de la etiqueta", () => {
    const s = texto(trabajoPrecios([item("1", "X")], { "1": conMedio(45900, 900) }).trabajos[0].datos)
    // "$900": 4 * 32 = 128 → 16 + 52
    expect(s).toContain('TEXT 68,44,"5",0,1,1,"$900"')
    // "X": 8 → 16 + 112
    expect(s).toContain('TEXT 128,24,"1",0,1,1,"X"')
  })

  it("precio largo: fuente 4 con alto doble, centrada en la misma franja (y=36)", () => {
    // "$1.234.567" = 10 caracteres: 320 con la "5", 240 con la "4" → cae a la "3" (160).
    expect(renglonPrecio("$41.310")).toMatchObject({ fuente: "5", y: 44, my: 1 })
    expect(renglonPrecio("$141.310")).toMatchObject({ fuente: "4", y: 36, mx: 1, my: 2 })
    expect(renglonPrecio("$1.234.567")).toMatchObject({ fuente: "3", y: 44, mx: 1, my: 2 })
    expect(renglonPrecio("$" + "9".repeat(14))).toBeNull()
    const s = texto(trabajoPrecios([item("1")], { "1": conMedio(200000, 141310) }).trabajos[0].datos)
    // 8 * 24 = 192 → 16 + 20
    expect(s).toContain('TEXT 36,36,"4",0,1,2,"$141.310"')
  })

  it("sin medio destacado (o no más barato): el precio de lista grande y sin las dos líneas de abajo", () => {
    for (const p of [soloLista(45900), conMedio(45900, 45900), conMedio(45900, 45899.8)]) {
      const lineas = textos(texto(trabajoPrecios([item("1")], { "1": p }).trabajos[0].datos))
      expect(lineas).toHaveLength(2)
      expect(lineas[1]).toBe('TEXT 20,44,"5",0,1,1,"$45.900"')
    }
  })

  it("el rótulo del medio va en minúscula y sin tildes (forma de pago: 'con débito')", () => {
    const s = texto(trabajoPrecios([item("1")], { "1": conMedio(1000, 900, "con débito") }).trabajos[0].datos)
    expect(s).toContain('"con debito"')
  })

  it("nombre recortado a 27 caracteres e imprimible", () => {
    const s = texto(trabajoPrecios([item("1", 'Tira "LED" ñandú ' + "x".repeat(40))], { "1": soloLista(10) }).trabajos[0].datos)
    const nombre = textos(s)[0].match(/"([^"]*)"$/)![1]
    expect(nombre.length).toBeLessThanOrEqual(27)
    expect(nombre.startsWith("Tira LED nandu")).toBe(true)
  })

  it("omite sin precio de lista, sin precio en el Shop, precio que no entra y cantidad inválida", () => {
    const r = trabajoPrecios(
      [item("1"), item("2"), item("3"), item("4"), item("5", "Cero", 0)],
      { "1": soloLista(100), "2": { precioLista: null, precioMedio: null }, "4": soloLista(1e14) },
    )
    expect(r.etiquetas).toBe(1)
    expect(r.omitidos).toEqual([
      { alegraId: "2", nombre: "Producto 2", motivo: MENSAJE_SIN_PRECIO },
      { alegraId: "3", nombre: "Producto 3", motivo: MENSAJE_SIN_PRECIO },
      { alegraId: "4", nombre: "Producto 4", motivo: MENSAJE_PRECIO_ANCHO },
      { alegraId: "5", nombre: "Cero", motivo: "Ingrese una cantidad entera entre 1 y 999." },
    ])
  })

  it("35 etiquetas = 2 tandas (10 y 2 filas)", () => {
    const r = trabajoPrecios([item("1", "Uno", 35)], { "1": soloLista(100) })
    expect(r.trabajos.map((t) => t.etiquetas)).toEqual([30, 5])
    expect(r.trabajos.every((t) => t.tipo === "precio-29x20")).toBe(true)
  })

  it("la vista previa lee fuente y multiplicadores del TSPL real", () => {
    const r = trabajoPrecios([item("1", "A")], { "1": conMedio(200000, 141310) })
    const fila = primeraFilaTspl(texto(r.trabajos[0].datos))
    expect(fila.textos.map((t) => [t.fuente, t.mx, t.my, t.texto])).toEqual([
      ["1", 1, 1, "A"],
      ["4", 1, 2, "$141.310"],
      ["1", 1, 1, "con transferencia"],
      ["2", 1, 1, "Lista $200.000"],
    ])
  })
})

describe("contenidoPrecio", () => {
  it("con medio: grande del medio, rótulo en minúscula y la lista", () => {
    expect(contenidoPrecio(conMedio(45900, 41310))).toEqual({
      ok: true,
      grande: "$41.310",
      rotulo: "con transferencia",
      lista: "Lista $45.900",
    })
  })
  it("sin precio: omitido", () => {
    expect(contenidoPrecio(undefined)).toEqual({ ok: false, mensaje: MENSAJE_SIN_PRECIO })
    expect(contenidoPrecio(soloLista(0))).toEqual({ ok: false, mensaje: MENSAJE_SIN_PRECIO })
  })
})

/** Doble del canvas: hoja blanca de 800x1200. */
const dibujarBlanco = async () => ({ data: new Uint8ClampedArray(800 * 1200 * 4).fill(255), width: 800, height: 1200 })

describe("layoutPrecio4 / trabajoPrecio4 (precio 4 por hoja, 100x150)", () => {
  it("2x2 celdas de 400x600; la última hoja se completa con vacías", () => {
    const l = layoutPrecio4([item("1", "Uno", 5)], { "1": conMedio(45900, 41310) })
    expect(l.etiquetas).toBe(5)
    expect(l.hojas).toHaveLength(2)
    expect(l.hojas[0].celdas.map((c) => c && [c.x, c.y, c.ancho, c.alto])).toEqual([
      [0, 0, 400, 600],
      [400, 0, 400, 600],
      [0, 600, 400, 600],
      [400, 600, 400, 600],
    ])
    expect(l.hojas[1].celdas.filter((c) => c === null)).toHaveLength(3)
    expect(l.hojas[0].celdas[0]).toMatchObject({
      nombre: "Uno",
      grande: "$41.310",
      rotulo: "con transferencia",
      lista: "Lista $45.900",
    })
  })

  it("mismos omitidos que la chica; sin medio, sólo el precio de lista", () => {
    const l = layoutPrecio4([item("1"), item("2"), item("3", "Cero", 0)], { "1": soloLista(500) })
    expect(l.hojas[0].celdas[0]).toMatchObject({ grande: "$500", rotulo: null, lista: null })
    expect(l.omitidos.map((o) => [o.alegraId, o.motivo])).toEqual([
      ["2", MENSAJE_SIN_PRECIO],
      ["3", "Ingrese una cantidad entera entre 1 y 999."],
    ])
  })

  it("un trabajo por hoja con la cabecera del rollo grande, un BITMAP y un PRINT", async () => {
    const hojas: HojaPrecio[] = []
    const r = await trabajoPrecio4([item("1", "Uno", 6)], { "1": soloLista(500) }, async (h) => {
      hojas.push(h)
      return dibujarBlanco()
    })
    expect(r.etiquetas).toBe(6)
    expect(r.trabajos.map((t) => t.etiquetas)).toEqual([4, 2])
    expect(r.trabajos.every((t) => t.tipo === "precio-4up")).toBe(true)
    const s = texto(r.trabajos[0].datos)
    expect(s.startsWith("SIZE 100 mm,150 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0\r\nREFERENCE 0,0\r\nDENSITY 10\r\nCLS\r\nBITMAP 0,0,100,1200,0,")).toBe(true)
    expect(s.match(/PRINT 1,1/g)).toHaveLength(1)
    expect(ROLLOS["precio-4up"]).toEqual(ROLLOS["qr-6up"])
  })

  it("sin nada imprimible no dibuja", async () => {
    let llamadas = 0
    const r = await trabajoPrecio4([item("1")], {}, async () => {
      llamadas++
      return dibujarBlanco()
    })
    expect(r).toMatchObject({ trabajos: [], etiquetas: 0 })
    expect(llamadas).toBe(0)
  })
})

describe("textosCeldaPrecio4 (etiqueta apaisada 600x400 del 4 por hoja)", () => {
  // Medidor simulado: cada carácter mide la mitad del tamaño de fuente.
  const medir = (t: string, px: number) => t.length * px * 0.5
  const celda = { nombre: "Lámpara LED 9W", grande: "$41.310", rotulo: "con transferencia", lista: "Lista $45.900" }

  it("nombre arriba, precio grande lo más grande que entra en 560, y el pie en un renglón", () => {
    const t = textosCeldaPrecio4(celda, medir)
    expect(t.map((x) => x.texto)).toEqual(["Lámpara LED 9W", "$41.310", "con transferencia", "Lista $45.900"])
    const [nombre, grande, rotulo, lista] = t
    expect(grande.px).toBe(160) // 7 * 160 / 2 = 560
    expect(nombre.y).toBeLessThan(grande.y)
    expect(rotulo.y).toBe(lista.y)
    expect(rotulo.y).toBeGreaterThan(grande.y)
    expect(rotulo.px).toBeLessThan(lista.px)
    expect(lista.x).toBeGreaterThan(rotulo.x + medir(rotulo.texto, rotulo.px))
  })

  it("todo centrado horizontal (el pie como un bloque) y vertical dentro de 600x400", () => {
    const t = textosCeldaPrecio4(celda, medir)
    for (const x of t.slice(0, 2)) expect(Math.abs(x.x * 2 + medir(x.texto, x.px) - 600)).toBeLessThanOrEqual(1)
    const [, , rotulo, lista] = t
    const finPie = lista.x + medir(lista.texto, lista.px)
    expect(Math.abs(rotulo.x - (600 - finPie))).toBeLessThanOrEqual(2)
    // Margen de arriba (al centro del nombre menos media caja) ~ margen de abajo.
    const arriba = t[0].y - Math.round(t[0].px * 1.2) / 2
    const abajo = 400 - (rotulo.y + Math.round(Math.max(lista.px, 30) * 1.2) / 2)
    expect(Math.abs(arriba - abajo)).toBeLessThanOrEqual(1)
    expect(t.every((x) => x.x >= 0 && x.x + medir(x.texto, x.px) <= 600)).toBe(true)
  })

  it("nombre largo en un solo renglón: achica y corta con …", () => {
    const [nombre] = textosCeldaPrecio4({ ...celda, nombre: "Lámpara LED ".repeat(10) }, medir)
    expect(nombre.texto.endsWith("…")).toBe(true)
    expect(medir(nombre.texto, nombre.px)).toBeLessThanOrEqual(560)
  })

  it("sin medio: sólo nombre y el precio de lista", () => {
    expect(textosCeldaPrecio4({ ...celda, grande: "$500", rotulo: null, lista: null }, medir).map((x) => x.texto)).toEqual([
      "Lámpara LED 9W",
      "$500",
    ])
  })

  it("pxQueEntra: el mayor tamaño que entra a lo ancho", () => {
    expect(pxQueEntra("$41.310", 344, 170, 40, medir)).toBe(98) // 7 * 98 / 2 = 343
    expect(pxQueEntra("$1", 344, 170, 40, medir)).toBe(170)
  })
})
