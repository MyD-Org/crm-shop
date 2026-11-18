import { describe, expect, it } from "vitest"
import { matrizQr, rotuloTienda, tiendaDelQr, urlProductoQr } from "./qr"
import { CELDAS_POR_HOJA, layoutQr6, QR6, type ItemEtiqueta } from "./trabajos"

const SHOP = "https://tienda.cliente.example/"
const items = (n: number): ItemEtiqueta[] =>
  Array.from({ length: n }, (_, i) => ({ alegraId: String(i + 1), referencia: null, nombre: `Producto ${i + 1}`, cantidad: 1 }))

describe("urlProductoQr", () => {
  it("codifica el alegraId y no deja barra doble", () => {
    const r = urlProductoQr(SHOP, "mdp:12")
    expect(r).toEqual({ ok: true, url: "https://tienda.cliente.example/producto/mdp%3A12" })
  })

  it.each([null, undefined, "", "  "])("sin shopUrl (%s) devuelve el mensaje en usted", (shop) => {
    expect(urlProductoQr(shop, "1")).toEqual({
      ok: false,
      mensaje: "No se puede armar el código QR porque la tienda no tiene dirección web.",
    })
  })
})

describe("matrizQr", () => {
  it("devuelve una matriz cuadrada de booleanos", async () => {
    const m = await matrizQr("https://tienda.cliente.example/producto/1")
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((f) => f.length === m.length)).toBe(true)
    // Patrón de posición: esquina superior izquierda negra.
    expect(m[0][0]).toBe(true)
  })
})

describe("layoutQr6", () => {
  it("6 productos = 1 hoja llena, grilla 2x3 de 400 px", () => {
    const r = layoutQr6(items(6), SHOP)
    if (!r.ok) throw new Error(r.mensaje)
    expect(r.hojas).toHaveLength(1)
    expect(r.hojas[0].celdas.every(Boolean)).toBe(true)
    expect(r.hojas[0].celdas.map((c) => [c?.x, c?.y])).toEqual([
      [0, 0], [400, 0], [0, 400], [400, 400], [0, 800], [400, 800],
    ])
    expect(r.hojas[0].celdas[0]).toMatchObject({
      ancho: QR6.celda,
      url: "https://tienda.cliente.example/producto/1",
      web: "tienda.cliente.example",
    })
  })

  it("7 productos = 2 hojas, la segunda con 5 celdas vacías", () => {
    const r = layoutQr6(items(7), SHOP)
    if (!r.ok) throw new Error(r.mensaje)
    expect(r.hojas).toHaveLength(2)
    expect(r.hojas[1].celdas).toHaveLength(CELDAS_POR_HOJA)
    expect(r.hojas[1].celdas.filter((c) => c === null)).toHaveLength(5)
    expect(r.etiquetas).toBe(7)
  })

  it("cada unidad de cantidad es una celda; cantidad inválida se omite", () => {
    const r = layoutQr6(
      [
        { alegraId: "1", referencia: null, nombre: "Uno", cantidad: 3 },
        { alegraId: "2", referencia: null, nombre: "Dos", cantidad: 0 },
      ],
      SHOP,
    )
    if (!r.ok) throw new Error(r.mensaje)
    expect(r.etiquetas).toBe(3)
    expect(r.omitidos).toEqual([{ alegraId: "2", nombre: "Dos", motivo: "Ingrese una cantidad entera entre 1 y 999." }])
  })

  it("sin shopUrl devuelve el mensaje", () => {
    expect(layoutQr6(items(1), null)).toEqual({
      ok: false,
      mensaje: "No se puede armar el código QR porque la tienda no tiene dirección web.",
    })
  })
})

describe("tienda del QR (varias tiendas en el mismo tenant)", () => {
  const tiendas = [
    { etiqueta: "Tienda principal", url: "https://tienda.cliente.example" },
    { etiqueta: "Segunda tienda", url: "https://otra.cliente.example" },
  ]

  it("sin elección → la principal; elegida válida → esa; elegida que ya no está → la principal", () => {
    expect(tiendaDelQr(tiendas, null)).toBe("https://tienda.cliente.example")
    expect(tiendaDelQr(tiendas, "https://otra.cliente.example")).toBe("https://otra.cliente.example")
    expect(tiendaDelQr(tiendas, "https://vieja.cliente.example")).toBe("https://tienda.cliente.example")
    expect(tiendaDelQr([], "https://otra.cliente.example")).toBeNull()
  })

  it("el QR y el host impreso siguen a la tienda elegida", () => {
    const l = layoutQr6(items(1), tiendaDelQr(tiendas, "https://otra.cliente.example"))
    expect(l.ok).toBe(true)
    if (!l.ok) return
    const celda = l.hojas[0].celdas[0]
    expect(celda).toMatchObject({ url: "https://otra.cliente.example/producto/1", web: "otra.cliente.example" })
  })

  it("rótulo de la opción: etiqueta y host", () => {
    expect(rotuloTienda(tiendas[1])).toBe("Segunda tienda (otra.cliente.example)")
    expect(rotuloTienda({ etiqueta: " ", url: "https://otra.cliente.example" })).toBe("otra.cliente.example")
  })
})
