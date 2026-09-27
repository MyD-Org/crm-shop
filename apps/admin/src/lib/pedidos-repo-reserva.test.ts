import { describe, expect, it } from "vitest"
import { RESERVA_EMISION_SENTINEL, RESERVA_EMISION_TTL_MINUTOS, estadoReservaEmision } from "./pedidos-repo"

// `estadoReservaEmision`: pura, sin red ni DB — decide si la reserva de "Emitir factura" (ver
// `reservarEmisionFactura`) sigue vigente o quedó colgada (la función que la creó murió a mitad
// de camino: timeout de Vercel, crash, deploy). La usan tanto `factura/emitir/route.ts` (POST/GET
// de emisión) como `factura/route.ts` (POST de vincular), para que la reserva vencida se trate
// como si el pedido no tuviera factura.

const AHORA = new Date("2026-09-27T12:00:00Z")

describe("estadoReservaEmision", () => {
  it("sin factura: null (no hay reserva)", () => {
    expect(estadoReservaEmision({ facturaAlegraId: null, facturadoEn: null }, AHORA)).toBeNull()
  })

  it("con una factura REAL (no el sentinel): null (no es una reserva)", () => {
    expect(estadoReservaEmision({ facturaAlegraId: "7040", facturadoEn: AHORA }, AHORA)).toBeNull()
  })

  it("sentinel reservado hace un instante: vigente", () => {
    const facturadoEn = new Date(AHORA.getTime() - 1000)
    expect(estadoReservaEmision({ facturaAlegraId: RESERVA_EMISION_SENTINEL, facturadoEn }, AHORA)).toBe("vigente")
  })

  it("sentinel justo en el borde del TTL (1s antes de vencer): vigente", () => {
    const facturadoEn = new Date(AHORA.getTime() - (RESERVA_EMISION_TTL_MINUTOS * 60_000 - 1000))
    expect(estadoReservaEmision({ facturaAlegraId: RESERVA_EMISION_SENTINEL, facturadoEn }, AHORA)).toBe("vigente")
  })

  it("sentinel justo pasado el TTL: vencida", () => {
    const facturadoEn = new Date(AHORA.getTime() - (RESERVA_EMISION_TTL_MINUTOS * 60_000 + 1000))
    expect(estadoReservaEmision({ facturaAlegraId: RESERVA_EMISION_SENTINEL, facturadoEn }, AHORA)).toBe("vencida")
  })

  it("sentinel sin facturadoEn (dato corrupto/imposible): se trata como vencida, nunca bloquea para siempre", () => {
    expect(estadoReservaEmision({ facturaAlegraId: RESERVA_EMISION_SENTINEL, facturadoEn: null }, AHORA)).toBe("vencida")
  })
})
