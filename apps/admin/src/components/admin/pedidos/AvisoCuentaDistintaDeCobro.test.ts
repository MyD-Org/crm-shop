import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { AvisoCobroDto } from "@/lib/pedido-factura-cuenta-repo"
import { AvisoCuentaDistintaDeCobro, puedeEmitirConAvisoCobro } from "./AvisoCuentaDistintaDeCobro"

// Aviso + casilla de confirmación de "Emitir factura" cuando se factura con una cuenta de Alegra
// distinta de la de la sucursal que cobró el pago en línea. Datos inventados.

const aviso: AvisoCobroDto = {
  cobradoCon: { slug: "mdp", nombre: "Mar del Plata" },
  facturaCon: { slug: "principal", nombre: "Iguazú SA" },
}

const render = (props: { aviso: AvisoCobroDto | null | undefined; confirmado?: boolean }) =>
  renderToStaticMarkup(
    createElement(AvisoCuentaDistintaDeCobro, { aviso: props.aviso, confirmado: props.confirmado ?? false, onConfirmadoChange: () => {} }),
  )

describe("AvisoCuentaDistintaDeCobro", () => {
  it("con aviso: Alert de advertencia con el texto exacto y la casilla", () => {
    const html = render({ aviso })
    expect(html).toContain("Cuenta distinta de la que cobró")
    expect(html).toContain(
      "Este pedido se cobró en línea con la cuenta de Mar del Plata, pero se va a facturar con la cuenta de Iguazú SA. " +
        "Facturar con un CUIT distinto del que recibió el cobro puede generar diferencias contables. " +
        "Si desea continuar, confirme a continuación.",
    )
    expect(html).toContain("Entiendo que se factura con una cuenta distinta de la que cobró y deseo continuar.")
    expect(html).toContain('role="checkbox"')
  })

  it("la casilla refleja si está marcada", () => {
    expect(render({ aviso, confirmado: false })).toContain('aria-checked="false"')
    expect(render({ aviso, confirmado: true })).toContain('aria-checked="true"')
  })

  it("sin aviso no renderiza nada (ni casilla)", () => {
    expect(render({ aviso: null })).toBe("")
    expect(render({ aviso: undefined })).toBe("")
  })
})

describe("puedeEmitirConAvisoCobro", () => {
  it("sin aviso no hace falta confirmar", () => {
    expect(puedeEmitirConAvisoCobro(null, false)).toBe(true)
    expect(puedeEmitirConAvisoCobro(undefined, false)).toBe(true)
  })
  it("con aviso, Emitir queda deshabilitado hasta marcar la casilla", () => {
    expect(puedeEmitirConAvisoCobro(aviso, false)).toBe(false)
    expect(puedeEmitirConAvisoCobro(aviso, true)).toBe(true)
  })
})
