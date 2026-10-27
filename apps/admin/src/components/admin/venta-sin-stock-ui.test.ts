import { describe, expect, it } from "vitest"
import { validarModalidad, type ModalidadSinStock } from "@/lib/modalidades-sin-stock-validacion"
import { bodyDesdeForm, formDesdeModalidad, opcionesModalidad, resumenModalidad } from "./venta-sin-stock-ui"

const m: ModalidadSinStock = { id: "m1", nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true }

describe("venta-sin-stock-ui", () => {
  it("resumen con plazo y flujo", () => expect(resumenModalidad(m)).toBe("Retiro en ~48 h · 2 días hábiles · Pago en línea"))
  it("resumen a coordinar y a confirmar", () =>
    expect(resumenModalidad({ ...m, texto: "A pedido", plazoDias: null, flujo: "a_confirmar" })).toBe("A pedido · a coordinar · A confirmar"))
  it("a coordinar manda plazoDias null", () =>
    expect(bodyDesdeForm({ nombre: "A", texto: "A pedido", plazo: "7", aCoordinar: true, flujo: "a_confirmar", activa: true })).toMatchObject({
      plazoDias: null,
      flujo: "a_confirmar",
    }))
  it("con plazo manda el texto del plazo", () =>
    expect(bodyDesdeForm({ nombre: "A", texto: "B", plazo: " 7 ", aCoordinar: false, flujo: "en_linea", activa: false })).toMatchObject({ plazoDias: "7", activa: false }))
  it("opciones: Ninguna primero e inactivas marcadas", () => {
    const inactiva: ModalidadSinStock = { ...m, id: "m2", nombre: "A pedido", activa: false }
    expect(opcionesModalidad([m, inactiva])).toEqual([
      { value: "ninguna", label: "Ninguna" },
      { value: "m1", label: "Modalidad 48 h" },
      { value: "m2", label: "A pedido (inactiva)" },
    ])
  })
  it("formulario vacío: pago en línea, activa, sin plazo", () =>
    expect(formDesdeModalidad()).toEqual({ nombre: "", texto: "", plazo: "", aCoordinar: false, flujo: "en_linea", activa: true }))
  it("ida y vuelta form ↔ modalidad", () => {
    expect(validarModalidad(bodyDesdeForm(formDesdeModalidad(m)))).toMatchObject({ ok: true, modalidad: { plazoDias: 2, nombre: "Modalidad 48 h" } })
    expect(validarModalidad(bodyDesdeForm(formDesdeModalidad({ ...m, plazoDias: null })))).toMatchObject({ ok: true, modalidad: { plazoDias: null } })
  })
})
