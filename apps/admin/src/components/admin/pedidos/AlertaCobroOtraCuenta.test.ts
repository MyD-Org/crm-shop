import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { PagoEnLineaDto } from "@/lib/pago-en-linea"
import { AlertaCobroOtraCuenta, textoCobroConOtraCuenta } from "./AlertaCobroOtraCuenta"

// Alerta de la tarjeta "Pago" cuando el cobro en línea se hizo con una cuenta distinta de la que
// correspondía (fallback del Shop). Datos inventados.

const nombres = { igz: "Iguazú", mdp: "Mar del Plata" }

const pago = (cuenta: PagoEnLineaDto["cuenta"], proveedor = "mercadopago"): PagoEnLineaDto => ({
  proveedor,
  referencia: "1",
  medio: "tarjeta",
  cuotas: 1,
  totalPagado: 100,
  info: {
    tipo: null, marca: null, ultimos4: null, aprobadoEn: null, autorizacion: null, cupon: null,
    netoRecibido: null, costoProcesador: null, cuentaCobro: cuenta?.slug ?? null, cuentaCobroPrevista: cuenta?.prevista ?? null,
  },
  cuenta,
})

const render = (p: PagoEnLineaDto | null) => renderToStaticMarkup(createElement(AlertaCobroOtraCuenta, { pago: p, nombresSucursal: nombres }))

describe("AlertaCobroOtraCuenta", () => {
  it("fallback de Mercado Pago: título y cuerpo con los nombres de las dos sucursales", () => {
    const html = render(pago({ slug: "igz", prevista: "mdp", fallback: true }))
    expect(html).toContain("Cobro con otra cuenta")
    expect(html).toContain(
      "Se cobró con la cuenta de Iguazú en lugar de la de Mar del Plata. " +
        "Revise las credenciales de Mar del Plata en Mercado Pago: no estaban cargadas o el procesador las rechazó.",
    )
  })

  it("fallback de Payway nombra a Payway", () => {
    expect(render(pago({ slug: "igz", prevista: "mdp", fallback: true }, "payway"))).toContain("de Mar del Plata en Payway:")
  })

  it("sin fallback, sin cuenta o sin pago en línea → no hay alerta", () => {
    expect(render(pago({ slug: "mdp", prevista: null, fallback: false }))).toBe("")
    expect(render(pago(null))).toBe("")
    expect(render(null)).toBe("")
  })

  it("un slug que ya no existe se muestra tal cual", () => {
    expect(textoCobroConOtraCuenta({ slug: "igz", prevista: "viejo", fallback: true }, "mercadopago", nombres)).toContain(
      "en lugar de la de viejo. Revise las credenciales de viejo en Mercado Pago",
    )
  })
})
