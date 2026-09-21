import { describe, it, expect } from "vitest"
import {
  ESTADOS_PEDIDO,
  ESTADO_PEDIDO_LABEL,
  MOTIVO_MAX,
  MOTIVO_MIN,
  esEstadoPedido,
  mensajeTransicionInvalida,
  puedeTransicionar,
  transicionesDesde,
  type EstadoPedido,
} from "./pedidos-transiciones"

// La tabla ESPERADA se escribe acá a mano, literal, y NO se importa del módulo: si alguien
// toca `TRANSICIONES` sin querer, este test tiene que fallar en vez de acompañar el cambio.
// Es la tabla FINAL que decidió el usuario (entregado no se cancela; cancelado es terminal).
const ESPERADO: Record<EstadoPedido, EstadoPedido[]> = {
  pendiente: ["confirmado", "cancelado"],
  confirmado: ["preparacion", "entregado", "pendiente", "cancelado"],
  preparacion: ["en_camino", "entregado", "confirmado", "cancelado"],
  en_camino: ["entregado", "preparacion", "cancelado"],
  entregado: ["en_camino", "preparacion", "confirmado"],
  cancelado: [],
}

const SEIS: EstadoPedido[] = ["pendiente", "confirmado", "preparacion", "en_camino", "entregado", "cancelado"]

describe("pedidos-transiciones", () => {
  it("los estados son exactamente los 6 del Shop, en su orden", () => {
    expect([...ESTADOS_PEDIDO]).toEqual(SEIS)
  })

  it("matriz completa: los 36 pares ordenados", () => {
    let permitidas = 0
    let prohibidas = 0
    for (const desde of SEIS) {
      for (const hacia of SEIS) {
        const esperado = ESPERADO[desde].includes(hacia)
        expect(puedeTransicionar(desde, hacia), `${desde} → ${hacia}`).toBe(esperado)
        if (esperado) permitidas++
        else prohibidas++
      }
    }
    // 16 aristas permitidas; 20 prohibidas = 14 pares distintos + los 6 "mismo estado".
    expect(permitidas).toBe(16)
    expect(prohibidas).toBe(20)
  })

  it("mismo estado nunca es una transición", () => {
    for (const e of SEIS) expect(puedeTransicionar(e, e)).toBe(false)
  })

  it("transicionesDesde devuelve la fila de la tabla, en orden", () => {
    for (const e of SEIS) expect([...transicionesDesde(e)]).toEqual(ESPERADO[e])
    expect([...transicionesDesde("cancelado")]).toEqual([])
    expect([...transicionesDesde("entregado")]).toEqual(["en_camino", "preparacion", "confirmado"])
    expect(transicionesDesde("entregado")).not.toContain("cancelado")
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
  })
})
