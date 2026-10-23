import { describe, expect, it } from "vitest"
import {
  asignarProvincia,
  ciudadesQueSonProvincias,
  enumerar,
  planZonas,
  provinciasLibres,
  resumenSucursal,
  type ZonaEditable,
} from "./zonas-envios"

const zona = (provincia: string, sucursal: string, facturaSucursal: string | null = null): ZonaEditable => ({
  provinciaClave: provincia.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  provincia,
  sucursal,
  facturaSucursal,
})

describe("planZonas", () => {
  it("guarda altas y cambios, quita las que ya no están", () => {
    const antes = [zona("Misiones", "igz"), zona("Corrientes", "igz"), zona("Buenos Aires", "mdp")]
    const despues = [zona("Misiones", "igz"), zona("Corrientes", "mdp"), zona("Chaco", "igz")]
    const plan = planZonas(antes, despues)
    expect(plan.guardar.map((z) => z.provincia)).toEqual(["Corrientes", "Chaco"])
    expect(plan.quitar).toEqual(["buenosaires"])
  })

  it("un cambio de quién factura también se guarda", () => {
    const plan = planZonas([zona("Misiones", "igz")], [zona("Misiones", "igz", "mdp")])
    expect(plan.guardar).toHaveLength(1)
    expect(plan.quitar).toEqual([])
  })
})

describe("asignarProvincia", () => {
  it("mueve la provincia y conserva quién factura si es otra sucursal", () => {
    const r = asignarProvincia([zona("Misiones", "igz", "central")], "Misiones", "mdp")
    expect(r).toEqual([zona("Misiones", "mdp", "central")])
  })

  it("si factura la misma que pasa a atender, queda «la que despacha»", () => {
    const r = asignarProvincia([zona("Misiones", "igz", "mdp")], "Misiones", "mdp")
    expect(r[0].facturaSucursal).toBeNull()
  })
})

it("provinciasLibres excluye las asignadas", () => {
  const libres = provinciasLibres([zona("Misiones", "igz")])
  expect(libres).not.toContain("Misiones")
  expect(libres).toContain("Corrientes")
})

it("ciudadesQueSonProvincias detecta provincias cargadas como ciudad", () => {
  expect(ciudadesQueSonProvincias(["Misiones", "Mar del Plata", "Ciudad de Buenos Aires"])).toEqual(["Misiones"])
})

it("enumerar", () => {
  expect(enumerar([])).toBe("")
  expect(enumerar(["A"])).toBe("A")
  expect(enumerar(["A", "B", "C"])).toBe("A, B y C")
})

describe("resumenSucursal", () => {
  const base = { activa: true, predeterminada: false, provincias: ["Misiones"], aceptaEnvio: true, ciudades: [] }

  it("toda la zona", () => {
    expect(resumenSucursal(base)).toBe(
      "Atiende los pedidos de Misiones. Envía a domicilio a cualquier ciudad de esa zona.",
    )
  })

  it("predeterminada con provincias y ciudades", () => {
    expect(resumenSucursal({ ...base, predeterminada: true, provincias: ["Buenos Aires"], ciudades: ["Mar del Plata", "Batán"] })).toBe(
      "Atiende los pedidos de Buenos Aires y de todas las provincias sin sucursal asignada. Envía a domicilio solo a Mar del Plata y Batán. En el resto de la zona, el cliente debe retirar el pedido en un local.",
    )
  })

  it("sin envío", () => {
    expect(resumenSucursal({ ...base, aceptaEnvio: false })).toContain("No envía a domicilio")
  })

  it("sin provincias ni predeterminada", () => {
    expect(resumenSucursal({ ...base, provincias: [] })).toBe(
      "No atiende ninguna provincia: solo recibe pedidos para retirar en este local.",
    )
  })

  it("inactiva", () => {
    expect(resumenSucursal({ ...base, activa: false })).toMatch(/^Sucursal inactiva/)
  })
})
