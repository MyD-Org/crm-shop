import { describe, it, expect } from "vitest"
import {
  ESTADOS_PEDIDO,
  ESTADO_PEDIDO_LABEL,
  MOTIVO_MAX,
  MOTIVO_MIN,
  esEstadoPedido,
  avisoCancelarConDevolucion,
  mensajeNoCancelable,
  motivosNoCancelable,
  motivoNoCancelable,
  mensajeTransicionInvalida,
  puedeTransicionar,
  transicionesDesde,
  type EntregaTipo,
  type EstadoPedido,
} from "./pedidos-transiciones"

// La tabla ESPERADA de ENVÍO se escribe acá a mano, literal, y NO se importa del módulo: si
// alguien toca la tabla sin querer, este test tiene que fallar en vez de acompañar el cambio.
// Es la tabla FINAL que decidió el usuario (entregado no se cancela; cancelado es terminal).
const ESPERADO_ENVIO: Record<EstadoPedido, EstadoPedido[]> = {
  pendiente: ["confirmado", "cancelado"],
  confirmado: ["preparacion", "entregado", "pendiente", "cancelado"],
  preparacion: ["en_camino", "entregado", "confirmado", "cancelado"],
  en_camino: ["entregado", "preparacion", "cancelado"],
  entregado: ["en_camino", "preparacion", "confirmado"],
  cancelado: [],
}

// RETIRO: la misma tabla, sin `en_camino` como destino (un retiro no "viaja"). `en_camino`
// sigue siendo un ORIGEN válido (dato viejo), con sus mismos destinos de envío.
const ESPERADO_RETIRO: Record<EstadoPedido, EstadoPedido[]> = {
  pendiente: ["confirmado", "cancelado"],
  confirmado: ["preparacion", "entregado", "pendiente", "cancelado"],
  preparacion: ["entregado", "confirmado", "cancelado"],
  en_camino: ["entregado", "preparacion", "cancelado"],
  entregado: ["preparacion", "confirmado"],
  cancelado: [],
}

const SEIS: EstadoPedido[] = ["pendiente", "confirmado", "preparacion", "en_camino", "entregado", "cancelado"]
const TIPOS: EntregaTipo[] = ["envio", "retiro"]
const ESPERADO: Record<EntregaTipo, Record<EstadoPedido, EstadoPedido[]>> = {
  envio: ESPERADO_ENVIO,
  retiro: ESPERADO_RETIRO,
}

describe("pedidos-transiciones", () => {
  it("los estados son exactamente los 6 del Shop, en su orden", () => {
    expect([...ESTADOS_PEDIDO]).toEqual(SEIS)
  })

  describe.each(TIPOS)("matriz completa (%s): los 36 pares ordenados", (tipo) => {
    it("cada par se decide igual que la tabla esperada", () => {
      let permitidas = 0
      let prohibidas = 0
      for (const desde of SEIS) {
        for (const hacia of SEIS) {
          const esperado = ESPERADO[tipo][desde].includes(hacia)
          expect(puedeTransicionar(desde, hacia, tipo), `${desde} → ${hacia} (${tipo})`).toBe(esperado)
          if (esperado) permitidas++
          else prohibidas++
        }
      }
      if (tipo === "envio") {
        expect(permitidas).toBe(16)
        expect(prohibidas).toBe(20)
      } else {
        // RETIRO: dos aristas menos que envío (preparacion→en_camino y entregado→en_camino).
        expect(permitidas).toBe(14)
        expect(prohibidas).toBe(22)
      }
    })
  })

  it("mismo estado nunca es una transición, para ningún tipo de entrega", () => {
    for (const e of SEIS) {
      expect(puedeTransicionar(e, e, "envio")).toBe(false)
      expect(puedeTransicionar(e, e, "retiro")).toBe(false)
    }
  })

  it("transicionesDesde devuelve la fila de la tabla, en orden, según el tipo de entrega", () => {
    for (const tipo of TIPOS) {
      for (const e of SEIS) expect([...transicionesDesde(e, tipo)]).toEqual(ESPERADO[tipo][e])
    }
    expect([...transicionesDesde("cancelado", "envio")]).toEqual([])
    expect([...transicionesDesde("entregado", "envio")]).toEqual(["en_camino", "preparacion", "confirmado"])
    expect(transicionesDesde("entregado", "envio")).not.toContain("cancelado")
  })

  it("retiro: preparación va directo a entregado (sin en_camino como destino)", () => {
    expect(transicionesDesde("preparacion", "retiro")).not.toContain("en_camino")
    expect(puedeTransicionar("preparacion", "entregado", "retiro")).toBe(true)
  })

  it("retiro: entregado corrige a preparación o confirmado, nunca a en_camino", () => {
    expect(transicionesDesde("entregado", "retiro")).toEqual(["preparacion", "confirmado"])
    expect(puedeTransicionar("entregado", "en_camino", "retiro")).toBe(false)
  })

  it("retiro con un pedido viejo en en_camino: sale a sus destinos normales", () => {
    expect(transicionesDesde("en_camino", "retiro")).toEqual(["entregado", "preparacion", "cancelado"])
    expect(puedeTransicionar("en_camino", "entregado", "retiro")).toBe(true)
    expect(puedeTransicionar("en_camino", "preparacion", "retiro")).toBe(true)
  })

  it("confirmado/preparación → entregado no depende del tipo de entrega", () => {
    for (const tipo of TIPOS) {
      expect(puedeTransicionar("confirmado", "entregado", tipo)).toBe(true)
      expect(puedeTransicionar("preparacion", "entregado", tipo)).toBe(true)
    }
  })

  it("esEstadoPedido sólo acepta los 6 valores", () => {
    for (const e of SEIS) expect(esEstadoPedido(e)).toBe(true)
    for (const v of ["despachado", "", "PENDIENTE", " pendiente", null, undefined, 1, {}, []]) {
      expect(esEstadoPedido(v)).toBe(false)
    }
  })

  it("etiquetas: las mismas que ve el cliente en el Shop", () => {
    expect(ESTADO_PEDIDO_LABEL).toEqual({
      pendiente: "Pendiente",
      confirmado: "Confirmado",
      preparacion: "En preparación",
      en_camino: "En camino",
      entregado: "Entregado",
      cancelado: "Cancelado",
    })
  })

  it("largo del motivo: 1..500 (después del trim)", () => {
    expect(MOTIVO_MIN).toBe(1)
    expect(MOTIVO_MAX).toBe(500)
  })

  describe("mensajeTransicionInvalida (textos canónicos del spec)", () => {
    it("entregado → cancelado tiene su mensaje propio", () => {
      expect(mensajeTransicionInvalida("entregado", "cancelado")).toBe("Un pedido entregado no se puede cancelar.")
    })

    it("desde cancelado, siempre el mismo mensaje (incluido cancelado → cancelado)", () => {
      for (const hacia of SEIS) {
        expect(mensajeTransicionInvalida("cancelado", hacia)).toBe(
          "El pedido está cancelado y no admite más cambios de estado.",
        )
      }
    })

    it("el resto usa el patrón genérico con las etiquetas", () => {
      expect(mensajeTransicionInvalida("pendiente", "entregado")).toBe(
        "No es posible cambiar el pedido de «Pendiente» a «Entregado».",
      )
      expect(mensajeTransicionInvalida("confirmado", "en_camino")).toBe(
        "No es posible cambiar el pedido de «Confirmado» a «En camino».",
      )
      expect(mensajeTransicionInvalida("preparacion", "preparacion")).toBe(
        "No es posible cambiar el pedido de «En preparación» a «En preparación».",
      )
    })

    it("retiro: preparación → en_camino usa el mensaje genérico (no existe esa parada)", () => {
      expect(mensajeTransicionInvalida("preparacion", "en_camino")).toBe(
        "No es posible cambiar el pedido de «En preparación» a «En camino».",
      )
    })
  })
})

describe("motivoNoCancelable / mensajeNoCancelable", () => {
  const libre = { pagoEstado: "pendiente", facturado: false, intentoPagoPendiente: false, estuvoEntregado: false }

  it("sin pago, factura, intento ni entrega previa se puede cancelar", () => {
    expect(motivoNoCancelable(libre)).toBeNull()
    expect(motivoNoCancelable({ ...libre, pagoEstado: "fallido" })).toBeNull()
  })

  it("cada bloqueo se detecta por separado", () => {
    expect(motivoNoCancelable({ ...libre, pagoEstado: "pagado" })).toBe("pagado")
    expect(motivoNoCancelable({ ...libre, facturado: true })).toBe("facturado")
    expect(motivoNoCancelable({ ...libre, intentoPagoPendiente: true })).toBe("pago_en_curso")
    expect(motivoNoCancelable({ ...libre, estuvoEntregado: true })).toBe("entregado")
  })

  it("con varios bloqueos gana el pago, después la factura, el intento y la entrega", () => {
    const todo = { pagoEstado: "pagado", facturado: true, intentoPagoPendiente: true, estuvoEntregado: true }
    expect(motivoNoCancelable(todo)).toBe("pagado")
    expect(motivoNoCancelable({ ...todo, pagoEstado: "pendiente" })).toBe("facturado")
    expect(motivoNoCancelable({ ...todo, pagoEstado: "pendiente", facturado: false })).toBe("pago_en_curso")
  })

  it("los mensajes están en usted", () => {
    expect(mensajeNoCancelable("pagado")).toMatch(/^No se puede cancelar un pedido pagado\./)
    expect(mensajeNoCancelable("facturado")).toContain("Desvincule")
    expect(mensajeNoCancelable("pago_en_curso")).toContain("inténtelo")
    expect(mensajeNoCancelable("entregado")).toContain("entregado")
  })
})

describe("cancelar con devolución", () => {
  it("motivosNoCancelable lista todos los bloqueos en orden", () => {
    expect(
      motivosNoCancelable({ pagoEstado: "pagado", facturado: true, intentoPagoPendiente: true, estuvoEntregado: true }),
    ).toEqual(["pagado", "facturado", "pago_en_curso", "entregado"])
    expect(
      motivosNoCancelable({ pagoEstado: "pendiente", facturado: false, intentoPagoPendiente: false, estuvoEntregado: false }),
    ).toEqual([])
  })

  it("el aviso se arma según el caso y combina los que aplican", () => {
    const pagado = "Antes de cancelarlo, gestione la devolución en Mercado Pago."
    const facturado = "Antes de cancelarlo, emita la nota de crédito en Alegra."
    expect(avisoCancelarConDevolucion({ pagado: true, facturado: false, pagoMetodo: "mercadopago" })).toBe(pagado)
    expect(avisoCancelarConDevolucion({ pagado: false, facturado: true })).toBe(facturado)
    expect(avisoCancelarConDevolucion({ pagado: true, facturado: true, pagoMetodo: "mercadopago" })).toBe(`${pagado} ${facturado}`)
    expect(avisoCancelarConDevolucion({ pagado: false, facturado: false })).toBe("")
  })

  it("pagado con Payway: la devolución se gestiona en Payway", () => {
    expect(avisoCancelarConDevolucion({ pagado: true, facturado: false, pagoMetodo: "payway" })).toBe(
      "Antes de cancelarlo, gestione la devolución en Payway.",
    )
  })

  it("pagado con cualquier medio sin cobro en línea: devolución al cliente", () => {
    const otro = "Antes de cancelarlo, gestione la devolución del pago al cliente."
    for (const pagoMetodo of ["transferencia", "efectivo", "a_coordinar", "cuenta_corriente", undefined]) {
      expect(avisoCancelarConDevolucion({ pagado: true, facturado: false, pagoMetodo })).toBe(otro)
    }
  })
})
