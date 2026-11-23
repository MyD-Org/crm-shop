import { describe, expect, it } from "vitest"
import { claveCuenta, codigoClienteEnCuenta } from "./pedido-cliente-cuenta"

describe("claveCuenta", () => {
  it("la principal es 'principal' aunque su slug sea otro", () => {
    expect(claveCuenta({ principal: true, slug: "igz" })).toBe("principal")
  })
  it("una secundaria es su slug", () => {
    expect(claveCuenta({ principal: false, slug: "mdp" })).toBe("mdp")
  })
})

describe("codigoClienteEnCuenta", () => {
  it("misma cuenta ⇒ el código del pedido", () => {
    expect(codigoClienteEnCuenta({ clienteCodigo: "123", clienteCuenta: "principal" }, "principal")).toBe("123")
    expect(codigoClienteEnCuenta({ clienteCodigo: "123", clienteCuenta: "mdp" }, "mdp")).toBe("123")
  })
  it("otra cuenta ⇒ null (el id no vale ahí)", () => {
    expect(codigoClienteEnCuenta({ clienteCodigo: "123", clienteCuenta: "mdp" }, "principal")).toBeNull()
    expect(codigoClienteEnCuenta({ clienteCodigo: "123", clienteCuenta: "principal" }, "mdp")).toBeNull()
  })
  it("sin código ⇒ null", () => {
    expect(codigoClienteEnCuenta({ clienteCodigo: null, clienteCuenta: "principal" }, "principal")).toBeNull()
    expect(codigoClienteEnCuenta({ clienteCodigo: "", clienteCuenta: "principal" }, "principal")).toBeNull()
  })
})
