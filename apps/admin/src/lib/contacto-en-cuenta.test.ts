import { describe, expect, it } from "vitest"
import { contactoInputDelPedido } from "./contacto-en-cuenta"

const base = {
  clienteCodigo: null,
  facturacionNroDoc: null,
  facturacionTipoDoc: null,
  facturacionCondicionIva: null,
  facturacionRazonSocial: null,
  contactoNombre: "Cliente Ejemplo",
  clienteEmail: "cliente@cliente.example",
}

describe("contactoInputDelPedido", () => {
  it("sin condición de IVA usa consumidor final (Alegra la exige, code 2055)", () => {
    expect(contactoInputDelPedido(base)).toEqual({
      name: "Cliente Ejemplo",
      identification: undefined,
      identificationType: undefined,
      ivaCondition: "FINAL_CONSUMER",
      email: "cliente@cliente.example",
    })
  })

  it("mapea condición y tipo de documento del Shop", () => {
    const input = contactoInputDelPedido({
      ...base,
      facturacionNroDoc: " 20111111112 ",
      facturacionTipoDoc: "CUIT",
      facturacionCondicionIva: "responsable_inscripto",
      facturacionRazonSocial: "Empresa Ejemplo SA",
    })
    expect(input).toMatchObject({
      name: "Empresa Ejemplo SA",
      identification: "20111111112",
      identificationType: "CUIT",
      ivaCondition: "IVA_RESPONSABLE",
    })
  })

  it("CUIL no es un tipo de Alegra: va sin identificationObject", () => {
    const input = contactoInputDelPedido({ ...base, facturacionNroDoc: "20111111112", facturacionTipoDoc: "CUIL" })
    expect(input.identificationType).toBeUndefined()
    expect(input.identification).toBe("20111111112")
  })
})
