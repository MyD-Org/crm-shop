import { describe, it, expect } from "vitest"
import {
  MSG_COBRO_ONLINE,
  SLUG_MERCADOPAGO,
  SLUGS_COBRO,
  esSlugCobro,
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

describe("filas fijas de cobro en línea", () => {
  it("SLUGS_COBRO incluye mercadopago y payway", () => {
    expect(SLUGS_COBRO).toEqual(["mercadopago", "payway"])
    expect(esSlugCobro("payway")).toBe(true)
    expect(esSlugCobro("transferencia")).toBe(false)
  })

  it("no se puede crear un medio con el slug payway", () => {
    expect(validarMedioPagoNuevo({ slug: "payway", nombre: "Payway" })).toEqual({
      ok: false,
      campo: "slug",
      error: "Ese identificador está reservado.",
    })
  })
})

describe("destacado y ficha", () => {
  it("acepta destacarEnCatalogo y mostrarEnFicha", () => {
    expect(validarMedioPagoCambios({ destacarEnCatalogo: true, mostrarEnFicha: false })).toEqual({
      ok: true,
      cambios: { destacarEnCatalogo: true, mostrarEnFicha: false },
    })
  })

  it("la lista ya no se enlaza por este camino: idListaPrecios se ignora", () => {
    expect(validarMedioPagoCambios({ idListaPrecios: "12", destacarEnCatalogo: true })).toEqual({
      ok: true,
      cambios: { destacarEnCatalogo: true },
    })
  })

  it("rechaza booleanos con tipo inválido, en usted", () => {
    expect(validarMedioPagoCambios({ mostrarEnFicha: "si" })).toEqual({
      ok: false,
      campo: "mostrarEnFicha",
      error: "El valor indicado no es válido.",
    })
    expect(validarMedioPagoCambios({ destacarEnCatalogo: 1 })).toMatchObject({ ok: false, campo: "destacarEnCatalogo" })
  })

  it("el alta ignora destacado y ficha (se configuran editando el medio)", () => {
    const r = validarMedioPagoNuevo({ slug: "ok", nombre: "x", destacarEnCatalogo: true, mostrarEnFicha: true })
    expect(r).toMatchObject({ ok: true })
    if (r.ok) {
      expect(r.valor).not.toHaveProperty("destacarEnCatalogo")
      expect(r.valor).not.toHaveProperty("mostrarEnFicha")
    }
  })
})

describe("audiencia del medio (solo cuentas corrientes)", () => {
  it("acepta 'publico' y 'cuenta_corriente' en los cambios y rechaza cualquier otro valor, en usted", () => {
    expect(validarMedioPagoCambios({ audiencia: "cuenta_corriente" })).toEqual({ ok: true, cambios: { audiencia: "cuenta_corriente" } })
    expect(validarMedioPagoCambios({ audiencia: "publico" })).toEqual({ ok: true, cambios: { audiencia: "publico" } })
    for (const malo of ["todos", "", 1, true, null]) {
      expect(validarMedioPagoCambios({ audiencia: malo })).toEqual({
        ok: false,
        campo: "audiencia",
        error: "El valor indicado no es válido.",
      })
    }
  })

  it("el alta puede nacer solo para cuentas corrientes; sin el campo no lo manda (rige el default de la base)", () => {
    const r = validarMedioPagoNuevo({ slug: "efectivo-cheque", nombre: "Efectivo o cheque", audiencia: "cuenta_corriente" })
    expect(r).toMatchObject({ ok: true, valor: { audiencia: "cuenta_corriente" } })
    const sin = validarMedioPagoNuevo({ slug: "otro", nombre: "Otro" })
    if (sin.ok) expect(sin.valor).not.toHaveProperty("audiencia")
  })

  it("un medio solo para cuentas corrientes aplica a retiro y a envío", () => {
    expect(
      validarMedioPagoNuevo({ slug: "cc", nombre: "CC", audiencia: "cuenta_corriente", aplicaEnvio: false }),
    ).toEqual({
      ok: false,
      campo: "aplicaRetiro",
      error: "El medio solo para cuentas corrientes debe aplicar a retiro y a envío.",
    })
  })
})

describe("opcionesCobro (migración 0073)", () => {
  it("las valida y las deja en orden canónico", () => {
    expect(validarMedioPagoCambios({ opcionesCobro: ["cuenta_mp", "debito"] })).toEqual({
      ok: true,
      cambios: { opcionesCobro: ["debito", "cuenta_mp"] },
    })
  })

  it("un valor desconocido o repetido es inválido, con el campo y el mensaje en usted", () => {
    expect(validarMedioPagoCambios({ opcionesCobro: ["efectivo"] })).toEqual({
      ok: false,
      campo: "opcionesCobro",
      error: "Las formas de pago indicadas no son válidas.",
    })
    expect(validarMedioPagoCambios({ opcionesCobro: ["debito", "debito"] })).toMatchObject({ ok: false, campo: "opcionesCobro" })
  })

  it("una lista vacía pasa la validación del cuerpo: la regla de al menos una se aplica sobre el estado resultante", () => {
    expect(validarMedioPagoCambios({ opcionesCobro: [] })).toEqual({ ok: true, cambios: { opcionesCobro: [] } })
  })

  it("sin el campo, el cambio no lo menciona", () => {
    const r = validarMedioPagoCambios({ nombre: "Mercado Pago" })
    expect(r.ok && "opcionesCobro" in r.cambios).toBe(false)
  })
})
