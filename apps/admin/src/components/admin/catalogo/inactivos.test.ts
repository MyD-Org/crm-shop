import { describe, expect, it } from "vitest"
import {
  FILTROS_INICIALES,
  conInactivos,
  estadoAlegraTexto,
  verInactivos,
} from "./inactivos"

describe("ocultar los inactivos de Alegra en el listado", () => {
  it("por defecto el listado sólo trae los activos", () => {
    expect(FILTROS_INICIALES.alegra).toBe("active")
    expect(verInactivos(FILTROS_INICIALES)).toBe(false)
  })

  it("«Ver también los inactivos» quita el filtro y apagarlo lo vuelve a poner", () => {
    const con = conInactivos({ alegra: "active", precio: "con" }, true)
    expect(con.alegra).toBeUndefined()
    expect(con.precio).toBe("con")
    expect(verInactivos(con)).toBe(true)
    expect(conInactivos(con, false).alegra).toBe("active")
  })

  it("un listado filtrado sólo por los de baja cuenta como «viendo inactivos»", () => {
    expect(verInactivos({ alegra: "inactive" })).toBe(true)
  })
})

describe("Estado en «Datos de Alegra»", () => {
  it("es Inactivo cuando el motivo de baja está, igual que el aviso", () => {
    expect(estadoAlegraTexto(["inactivo_en_alegra"])).toBe("Inactivo")
    expect(estadoAlegraTexto(["oculto", "inactivo_en_alegra", "sin_precio"])).toBe("Inactivo")
  })

  it("es Activo si no está dado de baja, aunque esté oculto o sin precio", () => {
    expect(estadoAlegraTexto([])).toBe("Activo")
    expect(estadoAlegraTexto(["oculto", "sin_precio"])).toBe("Activo")
  })
})
