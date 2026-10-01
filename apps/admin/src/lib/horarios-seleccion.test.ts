import { describe, it, expect } from "vitest"
import { resolverSucursalElegida } from "./horarios-seleccion"

const norte = { slug: "sede-norte", predeterminada: true }
const sur = { slug: "sede-sur", predeterminada: false }

describe("resolverSucursalElegida", () => {
  it("sin sucursales activas edita la empresa (null)", () => {
    expect(resolverSucursalElegida([], undefined)).toBeNull()
    expect(resolverSucursalElegida([], "sede-sur")).toBeNull()
  })

  it("sin parámetro: la predeterminada", () => {
    expect(resolverSucursalElegida([sur, norte], undefined)).toBe("sede-norte")
  })

  it("con parámetro válido: esa sucursal", () => {
    expect(resolverSucursalElegida([norte, sur], "sede-sur")).toBe("sede-sur")
  })

  it("slug inexistente, repetido en la URL o dado de baja: la predeterminada", () => {
    expect(resolverSucursalElegida([norte, sur], "otra")).toBe("sede-norte")
    expect(resolverSucursalElegida([norte, sur], ["sede-sur", "sede-sur"])).toBe("sede-norte")
    // una sucursal inactiva no llega en `activas`
    expect(resolverSucursalElegida([norte], "sede-vieja")).toBe("sede-norte")
  })

  it("sin predeterminada activa: la primera", () => {
    expect(resolverSucursalElegida([sur], undefined)).toBe("sede-sur")
  })
})
