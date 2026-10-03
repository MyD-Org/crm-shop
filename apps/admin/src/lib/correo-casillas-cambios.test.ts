import { describe, expect, it } from "vitest"
import { cambiosPendientes, type CasillaEditable } from "./correo-casillas-cambios"

const base: CasillaEditable = { id: "c1", email: "ventas@cliente.example", nombre: "Ventas", activa: false, orden: 0, adminUserIds: ["a"] }

describe("cambiosPendientes", () => {
  it("sin diferencias: nada para guardar", () => {
    expect(cambiosPendientes([base], [{ ...base }])).toEqual([])
  })

  it("distingue datos (nombre/activa) de accesos y no depende del orden de los ids", () => {
    const draft = [{ ...base, nombre: "Ventas Sur", activa: true, adminUserIds: ["b", "a"] }]
    expect(cambiosPendientes([base], draft)).toEqual([
      { id: "c1", datos: { nombre: "Ventas Sur", activa: true }, accesos: ["b", "a"] },
    ])
  })

  it("solo accesos: no manda datos; mismo conjunto en otro orden no cuenta", () => {
    const orig = [{ ...base, adminUserIds: ["a", "b"] }]
    expect(cambiosPendientes(orig, [{ ...orig[0], adminUserIds: ["b", "a"] }])).toEqual([])
    expect(cambiosPendientes(orig, [{ ...orig[0], adminUserIds: [] }])).toEqual([{ id: "c1", datos: null, accesos: [] }])
  })

  it("el nombre se compara recortado y uno vacío no se manda", () => {
    expect(cambiosPendientes([base], [{ ...base, nombre: "  Ventas " }])).toEqual([])
    expect(cambiosPendientes([base], [{ ...base, nombre: "  " }])).toEqual([])
  })
})
