import { describe, it, expect } from "vitest"
import {
  MSG_COBRO_ONLINE,
  SLUG_MERCADOPAGO,
  MSG_SIN_ENTREGA,
  validarMedioPagoCambios,
  validarMedioPagoNuevo,
} from "@/lib/medios-pago-shop-validacion"

describe("validarMedioPagoNuevo", () => {
  it("aplica los defaults del design", () => {
    const r = validarMedioPagoNuevo({ slug: "transferencia", nombre: "  Transferencia bancaria " })
    expect(r).toEqual({
      ok: true,
      valor: {
        slug: "transferencia",
        nombre: "Transferencia bancaria",
        instrucciones: "",
        activo: true,
        aplicaRetiro: true,
        aplicaEnvio: true,
        cobroOnline: false,
        orden: 0,
      },
    })
  })

  it("rechaza slug fuera del patrón, sin nombre y body que no es objeto", () => {
    expect(validarMedioPagoNuevo({ slug: "A", nombre: "x" })).toMatchObject({ ok: false, campo: "slug" })
    expect(validarMedioPagoNuevo({ slug: "con espacio", nombre: "x" })).toMatchObject({ ok: false, campo: "slug" })
    expect(validarMedioPagoNuevo({ slug: "a".repeat(31), nombre: "x" })).toMatchObject({ ok: false, campo: "slug" })
    expect(validarMedioPagoNuevo({ slug: "ok", nombre: " " })).toMatchObject({ ok: false, campo: "nombre" })
    expect(validarMedioPagoNuevo(null)).toMatchObject({ ok: false, campo: "body" })
  })

  it("exige al menos retiro o envío y no admite cobro online todavía", () => {
    expect(validarMedioPagoNuevo({ slug: "ok", nombre: "x", aplicaRetiro: false, aplicaEnvio: false })).toEqual({
      ok: false,
      campo: "aplicaRetiro",
      error: MSG_SIN_ENTREGA,
    })
    expect(validarMedioPagoNuevo({ slug: "ok", nombre: "x", cobroOnline: true })).toEqual({
      ok: false,
      campo: "cobroOnline",
      error: MSG_COBRO_ONLINE,
    })
  })

  it("limita las instrucciones y el orden", () => {
    expect(validarMedioPagoNuevo({ slug: "ok", nombre: "x", instrucciones: "a".repeat(1001) })).toMatchObject({ ok: false, campo: "instrucciones" })
    expect(validarMedioPagoNuevo({ slug: "ok", nombre: "x", orden: -1 })).toMatchObject({ ok: false, campo: "orden" })
    expect(validarMedioPagoNuevo({ slug: "ok", nombre: "x", orden: "3" })).toMatchObject({ ok: true })
  })
})

describe("validarMedioPagoCambios", () => {
  it("devuelve solo lo presente y ignora el slug", () => {
    expect(validarMedioPagoCambios({ activo: false, slug: "otro" })).toEqual({ ok: true, cambios: { activo: false } })
  })
  it("valida los tipos", () => {
    expect(validarMedioPagoCambios({ activo: "no" })).toMatchObject({ ok: false, campo: "activo" })
    expect(validarMedioPagoCambios([])).toMatchObject({ ok: false, campo: "body" })
  })
})

describe("fila fija Mercado Pago", () => {
  it("no se puede crear un medio con el slug mercadopago", () => {
    expect(SLUG_MERCADOPAGO).toBe("mercadopago")
    expect(validarMedioPagoNuevo({ slug: "mercadopago", nombre: "Mercado Pago" })).toEqual({
      ok: false,
      campo: "slug",
      error: "Ese identificador está reservado.",
    })
  })

  it("los cambios de activo, orden y entrega son válidos y cobroOnline=true sigue rechazado", () => {
    expect(validarMedioPagoCambios({ activo: true, orden: 4, aplicaEnvio: false })).toEqual({
      ok: true,
      cambios: { activo: true, orden: 4, aplicaEnvio: false },
    })
    expect(validarMedioPagoCambios({ cobroOnline: true })).toMatchObject({ ok: false, campo: "cobroOnline" })
  })
})
