import { describe, expect, it } from "vitest"
import {
  agregarSinDuplicar,
  aplicarStockSucursal,
  cantidadPorStock,
  filasDeProducto,
  itemsDeLista,
  mensajeEnviadas,
  tituloOmitidos,
  type FilaLista,
} from "./lista"

const fila = (alegraId: string, extra: Partial<FilaLista> = {}): FilaLista => ({
  alegraId,
  referencia: "R" + alegraId,
  nombre: "Producto " + alegraId,
  cantidad: "1",
  stock: {},
  ...extra,
})

describe("filasDeProducto", () => {
  it("un producto suelto es una fila con cantidad 1 y su stock por sucursal", () => {
    const f = filasDeProducto({
      alegraId: "7",
      code: "LED-1",
      nombreEfectivo: "Lámpara",
      stockSucursales: [{ sucursal: "igz", stock: "8.000" }, { sucursal: "mdp", stock: "-2" }],
    })
    expect(f).toEqual([{ alegraId: "7", referencia: "LED-1", nombre: "Lámpara", cantidad: "1", stock: { igz: 8, mdp: -2 } }])
  })

  it("un modelo se abre en sus variantes, con el nombre del modelo + la opción", () => {
    const f = filasDeProducto({
      alegraId: "10",
      code: null,
      nombreEfectivo: "Tira LED",
      stockSucursales: [],
      variantes: [
        { alegraId: "11", code: "TIRA-V", nombreAlegra: "Tira verde", etiqueta: "Verde", stockSucursales: [] },
        { alegraId: "12", code: null, nombreAlegra: "Tira RGB", etiqueta: null, stockSucursales: [{ sucursal: "igz", stock: "3" }] },
      ],
    })
    expect(f.map((x) => [x.alegraId, x.referencia, x.nombre])).toEqual([
      ["11", "TIRA-V", "Tira LED Verde"],
      ["12", null, "Tira RGB"],
    ])
    expect(f[1].stock).toEqual({ igz: 3 })
  })
})

describe("agregarSinDuplicar", () => {
  it("saltea los ya presentes y los repetidos dentro de lo nuevo", () => {
    const r = agregarSinDuplicar([fila("1")], [fila("1"), fila("2"), fila("2"), fila("3")])
    expect(r.agregadas).toBe(2)
    expect(r.lista.map((f) => f.alegraId)).toEqual(["1", "2", "3"])
  })

  it("sin nada nuevo devuelve la misma lista", () => {
    const lista = [fila("1")]
    expect(agregarSinDuplicar(lista, [fila("1")]).lista).toBe(lista)
  })
})

describe("cantidad por stock de sucursal", () => {
  it("redondea y respeta el mínimo 1 (marca stock 0, negativo o sin dato)", () => {
    expect(cantidadPorStock(8)).toEqual({ cantidad: 8, sinStock: false })
    expect(cantidadPorStock(2.6)).toEqual({ cantidad: 3, sinStock: false })
    expect(cantidadPorStock(0)).toEqual({ cantidad: 1, sinStock: true })
    expect(cantidadPorStock(-4)).toEqual({ cantidad: 1, sinStock: true })
    expect(cantidadPorStock(undefined)).toEqual({ cantidad: 1, sinStock: true })
    expect(cantidadPorStock(5000)).toEqual({ cantidad: 999, sinStock: false })
  })

  it("aplica el stock de la sucursal elegida y al volver a manual conserva las cantidades", () => {
    const lista = [fila("1", { stock: { igz: 8, mdp: 1 } }), fila("2", { stock: { mdp: 3 } })]
    const igz = aplicarStockSucursal(lista, "igz")
    expect(igz.map((f) => [f.cantidad, f.sinStock])).toEqual([["8", false], ["1", true]])
    const manual = aplicarStockSucursal(igz, null)
    expect(manual.map((f) => f.cantidad)).toEqual(["8", "1"])
    expect(manual.every((f) => f.sinStock === undefined)).toBe(true)
  })
})

describe("itemsDeLista", () => {
  it("convierte las cantidades válidas y aparta las inválidas", () => {
    const r = itemsDeLista([fila("1", { cantidad: "12" }), fila("2", { cantidad: "0" }), fila("3", { cantidad: "abc" }), fila("4", { cantidad: "1.5" })])
    expect(r.items).toEqual([{ alegraId: "1", referencia: "R1", nombre: "Producto 1", cantidad: 12 }])
    expect(r.invalidas).toEqual(["2", "3", "4"])
  })
})

describe("resumen", () => {
  it("mensajes en singular y plural", () => {
    expect(mensajeEnviadas(1)).toBe("Se envió 1 etiqueta a la impresora.")
    expect(mensajeEnviadas(7)).toBe("Se enviaron 7 etiquetas a la impresora.")
    expect(tituloOmitidos([{ alegraId: "1", nombre: "X", motivo: "m" }])).toBe("Se omitió 1 producto:")
    expect(tituloOmitidos([])).toBe("Se omitieron 0 productos:")
  })
})
