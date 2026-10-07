import { describe, expect, it } from "vitest"
import {
  MSG_POSICION_INVALIDA,
  ORDEN_DESTACADO_SIN_POSICION,
  formularioDeOrden,
  ordenDeFormulario,
  reordenarDisponible,
} from "./destacado"

describe("formularioDeOrden", () => {
  it("sin orden = no destacado", () => {
    expect(formularioDeOrden(null)).toEqual({ destacado: false, posicion: "" })
  })

  it("9999 = destacado sin posición", () => {
    expect(ORDEN_DESTACADO_SIN_POSICION).toBe(9999)
    expect(formularioDeOrden(9999)).toEqual({ destacado: true, posicion: "" })
  })

  it("cualquier otro número = destacado con esa posición", () => {
    expect(formularioDeOrden(5)).toEqual({ destacado: true, posicion: "5" })
    expect(formularioDeOrden(1)).toEqual({ destacado: true, posicion: "1" })
  })
})

describe("ordenDeFormulario", () => {
  it("destildado = null, aunque quede una posición escrita", () => {
    expect(ordenDeFormulario({ destacado: false, posicion: "" })).toEqual({ ok: true, orden: null })
    expect(ordenDeFormulario({ destacado: false, posicion: "abc" })).toEqual({ ok: true, orden: null })
  })

  it("tildado y sin posición = 9999", () => {
    expect(ordenDeFormulario({ destacado: true, posicion: "" })).toEqual({ ok: true, orden: 9999 })
    expect(ordenDeFormulario({ destacado: true, posicion: "   " })).toEqual({ ok: true, orden: 9999 })
  })

  it("posición entre 1 y 9998", () => {
    expect(ordenDeFormulario({ destacado: true, posicion: "1" })).toEqual({ ok: true, orden: 1 })
    expect(ordenDeFormulario({ destacado: true, posicion: " 12 " })).toEqual({ ok: true, orden: 12 })
    expect(ordenDeFormulario({ destacado: true, posicion: "9998" })).toEqual({ ok: true, orden: 9998 })
  })

  it("posición inválida: mensaje en usted", () => {
    expect(MSG_POSICION_INVALIDA).toBe("Ingrese una posición entre 1 y 9998.")
    for (const posicion of ["0", "abc", "10000", "9999", "-3", "1.5", "2,5"]) {
      expect(ordenDeFormulario({ destacado: true, posicion })).toEqual({ ok: false, error: MSG_POSICION_INVALIDA })
    }
  })

  it("ida y vuelta con formularioDeOrden", () => {
    for (const orden of [null, 9999, 1, 42, 9998]) {
      expect(ordenDeFormulario(formularioDeOrden(orden))).toEqual({ ok: true, orden })
    }
  })
})

describe("reordenarDisponible", () => {
  const CAT = "0b9f1c7e-3f5a-4c8e-9d1a-2b3c4d5e6f70"

  it("sólo con Destacados + una categoría concreta y ningún otro filtro", () => {
    expect(reordenarDisponible({ destacado: "si", categoria: CAT })).toBe(true)
  })

  it("no sin el filtro Destacados, sin categoría o con «sin clasificar»", () => {
    expect(reordenarDisponible({ categoria: CAT })).toBe(false)
    expect(reordenarDisponible({ destacado: "si" })).toBe(false)
    expect(reordenarDisponible({ destacado: "si", categoria: "sin" })).toBe(false)
  })

  it("no si hay otro filtro o búsqueda: la lista visible no sería el conjunto que se renumera", () => {
    const otros = [
      { q: "led" },
      { estado: "visible" },
      { foto: "con" },
      { nombre: "sin" },
      { alegra: "active" },
      { precio: "con" },
      { stock: "con" },
      { tag: "t" },
      { cuenta: "principal" },
      { sucursal: "visible:igz" },
      { stockEn: "igz" },
    ]
    for (const extra of otros) {
      expect(reordenarDisponible({ destacado: "si", categoria: CAT, ...extra }), JSON.stringify(extra)).toBe(false)
    }
  })

  it("una búsqueda vacía no cuenta", () => {
    expect(reordenarDisponible({ destacado: "si", categoria: CAT, q: "" })).toBe(true)
  })
})
