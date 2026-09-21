import { describe, expect, it } from "vitest"
import { ESTADOS_PEDIDO } from "@/lib/pedidos-transiciones"
import {
  condicionIvaLabel,
  entregaLabel,
  fmtCantidad,
  fmtFechaPedido,
  fmtMoneda,
  pagoEstadoLabel,
  pagoMetodoLabel,
  textoUltimoCambio,
  tonoEstado,
} from "./format"

// Intl separa el símbolo del número con un espacio duro (U+00A0): se normaliza para comparar.
const plano = (s: string | null) => (s ?? "").replace(/\s/g, " ")

describe("fmtMoneda", () => {
  it("formatea pesos argentinos con dos decimales", () => {
    expect(plano(fmtMoneda(123456.7))).toBe("$ 123.456,70")
    expect(plano(fmtMoneda(0))).toBe("$ 0,00")
  })

  it("no revienta con un número inválido", () => {
    expect(fmtMoneda(Number.NaN)).toBe("—")
  })
})

describe("fmtFechaPedido", () => {
  it("usa SIEMPRE la hora de Argentina, no la del proceso (server UTC vs navegador -03)", () => {
    // 02:30 UTC del 22 = 23:30 del 21 en Buenos Aires: si faltara el timeZone, el server
    // (UTC) y el navegador darían días distintos y React marcaría hydration mismatch.
    expect(plano(fmtFechaPedido("2026-09-22T02:30:00.000Z"))).toBe("21/09/2026, 23:30")
  })

  it("no usa espacios raros (U+202F) que difieren entre Node y el navegador", () => {
    expect(fmtFechaPedido("2026-09-22T02:30:00.000Z")).not.toMatch(/ /)
  })

  it("devuelve una raya ante un ISO inválido o ausente", () => {
    expect(fmtFechaPedido("no-es-fecha")).toBe("—")
    expect(fmtFechaPedido(null)).toBe("—")
  })
})

describe("fmtCantidad", () => {
  it("muestra enteros sin decimales y fracciones con coma", () => {
    expect(fmtCantidad(3)).toBe("3")
    expect(fmtCantidad(1.5)).toBe("1,5")
    expect(fmtCantidad(1200)).toBe("1.200")
  })
})

describe("tonoEstado", () => {
  it("tiene un tono para cada uno de los 6 estados", () => {
    expect(ESTADOS_PEDIDO.map(tonoEstado)).toEqual([
      "warning",
      "info",
      "info",
      "info",
      "success",
      "danger",
    ])
  })
})

describe("etiquetas", () => {
  it("entrega: Retiro / Envío; lo desconocido se muestra crudo", () => {
    expect(entregaLabel("retiro")).toBe("Retiro")
    expect(entregaLabel("envio")).toBe("Envío")
    expect(entregaLabel("dron")).toBe("dron")
  })

  it("medio de pago: a_coordinar con la etiqueta del Shop; lo desconocido, crudo", () => {
    expect(pagoMetodoLabel("a_coordinar")).toBe("A coordinar con un asesor")
    expect(pagoMetodoLabel("transferencia")).toBe("Transferencia bancaria")
    expect(pagoMetodoLabel("cripto")).toBe("cripto")
    // Una clave heredada de Object.prototype no es un medio de pago.
    expect(pagoMetodoLabel("toString")).toBe("toString")
  })

  it("estado del pago", () => {
    expect(pagoEstadoLabel("pendiente")).toBe("Pago pendiente")
    expect(pagoEstadoLabel("pagado")).toBe("Pagado")
    expect(pagoEstadoLabel("fallido")).toBe("Pago rechazado")
    expect(pagoEstadoLabel("otro")).toBe("otro")
  })

  it("condición de IVA", () => {
    expect(condicionIvaLabel("responsable_inscripto")).toBe("Responsable inscripto")
    expect(condicionIvaLabel("consumidor_final")).toBe("Consumidor final")
    expect(condicionIvaLabel("exento")).toBe("exento")
    expect(condicionIvaLabel(null)).toBe("—")
  })
})

describe("textoUltimoCambio", () => {
  it("por {nombre} el {fecha}", () => {
    expect(plano(textoUltimoCambio("Ana Pérez", "2026-09-22T02:30:00.000Z"))).toBe(
      "por Ana Pérez el 21/09/2026, 23:30",
    )
  })

  it("sin nombre sólo dice la fecha", () => {
    expect(plano(textoUltimoCambio(null, "2026-09-22T02:30:00.000Z"))).toBe("el 21/09/2026, 23:30")
  })

  it("sin fecha no hay nada que mostrar", () => {
    expect(textoUltimoCambio("Ana", null)).toBeNull()
  })
})
