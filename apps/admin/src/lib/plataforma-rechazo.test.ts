import { describe, it, expect } from "vitest"
import { mensajeRechazoPlataforma } from "./plataforma-rechazo"

describe("mensajeRechazoPlataforma", () => {
  it("traduce el puntero JSON a la clave y el motivo a usted", () => {
    expect(mensajeRechazoPlataforma("invalid_data", ["/ip/n must be <= 69"])).toBe("La plataforma rechazó los valores: un valor está fuera de rango (ip).")
    expect(mensajeRechazoPlataforma("invalid_data", ["/potencia_w/n must be >= 0", "/tono/t must be equal to one of the allowed values"])).toBe(
      "La plataforma rechazó los valores: un valor está fuera de rango (potencia_w); un valor no está entre los permitidos (tono).",
    )
    expect(mensajeRechazoPlataforma("invalid_data", ["/zocalo/t must be string"])).toBe("La plataforma rechazó los valores: un valor no tiene el formato esperado (zocalo).")
    expect(mensajeRechazoPlataforma("invalid_data", ["/flujo_lm must NOT have fewer than 1 items"])).toBe("La plataforma rechazó los valores: un valor no es válido (flujo_lm).")
  })

  it("clave no declarada (additionalProperties en la raíz)", () => {
    expect(mensajeRechazoPlataforma("invalid_data", ["/ must NOT have additional properties (precio)"])).toBe(
      "La plataforma rechazó los valores: la clave no está declarada en la plataforma (precio).",
    )
  })

  it("sin puntero reconocible: el detalle tal cual; sin detalles: el código", () => {
    expect(mensajeRechazoPlataforma("interceptor_rejected", ["meta.fuente requerida"])).toBe("La plataforma rechazó los valores: meta.fuente requerida.")
    expect(mensajeRechazoPlataforma("anchor_mismatch", [])).toBe("La plataforma rechazó los valores: anchor_mismatch.")
  })
})
