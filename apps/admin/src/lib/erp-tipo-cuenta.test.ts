import { describe, expect, it } from "vitest"
import { tipoCuentaDeContacto } from "./erp"

// Cuenta corriente = el contacto tiene plazo de pago o límite de crédito en Alegra (así
// lo cargan en la sucursal). Decide si el portal muestra deuda y condiciones comerciales.

describe("tipoCuentaDeContacto", () => {
  it("corriente con plazo de pago o con límite de crédito", () => {
    expect(tipoCuentaDeContacto({ paymentTermDays: 30, creditLimit: null })).toBe("corriente")
    expect(tipoCuentaDeContacto({ paymentTermDays: null, creditLimit: 500000 })).toBe("corriente")
    expect(tipoCuentaDeContacto({ paymentTermDays: 0, creditLimit: 100 })).toBe("corriente")
  })

  it("contado sin plazo ni límite (plazo Contado = 0 días)", () => {
    expect(tipoCuentaDeContacto({ paymentTermDays: null, creditLimit: null })).toBe("contado")
    expect(tipoCuentaDeContacto({ paymentTermDays: 0, creditLimit: 0 })).toBe("contado")
    expect(tipoCuentaDeContacto({ paymentTermDays: null, creditLimit: Number.NaN })).toBe("contado")
  })
})
