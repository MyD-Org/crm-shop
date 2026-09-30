import { describe, expect, it } from "vitest"
import { SIN_SUCURSAL, reglaATexto, whatsappLink } from "./sucursales-texto"
import type { ReglaAplicada } from "./sucursales-zona"

const nombres = { igz: "Iguazú", mdp: "Mar del Plata" }
const base: ReglaAplicada = {
  v: 1,
  regla: "zona:misiones",
  motivo: "zona",
  provincia: "misiones",
  zonaId: "z1",
  sucursalZona: "igz",
  facturaSucursal: null,
  lineasATraer: [],
}

describe("reglaATexto", () => {
  it("pedido sin sucursal (anterior a las sucursales)", () => {
    expect(reglaATexto(null, null, nombres)).toBe(SIN_SUCURSAL)
    expect(reglaATexto(null, base, nombres)).toBe(SIN_SUCURSAL)
  })

  it("por zona", () => {
    expect(reglaATexto("igz", base, nombres)).toBe("Iguazú, por zona Misiones")
  })

  it("provincia sin zona: predeterminada", () => {
    const r: ReglaAplicada = { ...base, regla: "zona:default", motivo: "predeterminada", provincia: "cordoba", zonaId: null }
    expect(reglaATexto("mdp", r, nombres)).toBe("Mar del Plata, sucursal predeterminada (Córdoba no tiene zona)")
    expect(reglaATexto("mdp", { ...r, provincia: null }, nombres)).toBe("Mar del Plata, sucursal predeterminada")
  })

  it("respaldo por sucursal inactiva", () => {
    const r: ReglaAplicada = { ...base, motivo: "fallback_inactiva", regla: "zona:fallback_inactiva" }
    expect(reglaATexto("mdp", r, nombres)).toBe("Mar del Plata, por respaldo (la sucursal de la zona está inactiva)")
  })

  it("retiro en local", () => {
    const r: ReglaAplicada = { ...base, motivo: "retiro_local", regla: "retiro:mdp", provincia: null, zonaId: null }
    expect(reglaATexto("mdp", r, nombres)).toBe("Mar del Plata, por retiro en local")
  })

  it("sucursal rellenada sin regla y slug desconocido", () => {
    expect(reglaATexto("mdp", null, nombres)).toBe("Mar del Plata, pedido anterior a las zonas")
    expect(reglaATexto("xyz", base, {})).toBe("xyz, por zona Misiones")
  })
})

describe("whatsappLink", () => {
  it("deja solo los dígitos", () => {
    expect(whatsappLink("+00 0 000 000-0000")).toBe("https://wa.me/0000000000000")
    expect(whatsappLink("(000) 555-0100")).toBe("https://wa.me/0005550100")
  })
  it("sin número utilizable → null", () => {
    expect(whatsappLink("")).toBeNull()
    expect(whatsappLink(null)).toBeNull()
    expect(whatsappLink("s/d")).toBeNull()
    expect(whatsappLink("123")).toBeNull()
  })
})
