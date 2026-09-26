import { describe, expect, it } from "vitest"
import {
  FILTROS_INICIALES,
  OPCIONES_ACCESO,
  OPCIONES_PEDIDOS,
  OPCIONES_VINCULO,
  etiquetaAcceso,
  etiquetaMetodo,
  etiquetaTipoCuenta,
  etiquetaVinculo,
  hayFiltros,
  mensajeVacio,
  queryDeLista,
  tonoAcceso,
  tonoVinculo,
} from "./logica"

describe("queryDeLista", () => {
  it("manda los filtros explícitos y omite la búsqueda vacía", () => {
    const qs = new URLSearchParams(queryDeLista({ ...FILTROS_INICIALES, start: 0, limit: 25 }))
    expect(Object.fromEntries(qs)).toEqual({ vinculo: "todos", acceso: "todos", pedidos: "todos", start: "0", limit: "25" })
  })

  it("recorta la búsqueda y la codifica", () => {
    const qs = new URLSearchParams(
      queryDeLista({ q: "  ana@cliente.example ", vinculo: "vinculados", acceso: "con", pedidos: "con", start: 50, limit: 25 }),
    )
    expect(qs.get("q")).toBe("ana@cliente.example")
    expect(qs.get("vinculo")).toBe("vinculados")
    expect(qs.get("acceso")).toBe("con")
    expect(qs.get("pedidos")).toBe("con")
    expect(qs.get("start")).toBe("50")
  })

  it("start negativo o con decimales se normaliza", () => {
    expect(new URLSearchParams(queryDeLista({ ...FILTROS_INICIALES, start: -3.7, limit: 25 })).get("start")).toBe("0")
    expect(new URLSearchParams(queryDeLista({ ...FILTROS_INICIALES, start: 25.9, limit: 25 })).get("start")).toBe("25")
  })
})

describe("etiquetas y tonos", () => {
  it("vínculo", () => {
    expect(etiquetaVinculo("sin_vincular")).toBe("Sin vincular")
    expect(etiquetaVinculo("sin_coincidencia")).toBe("Sin coincidencia")
    expect(etiquetaVinculo("ambiguo")).toBe("Ambiguo")
    expect(etiquetaVinculo("vinculado")).toBe("Vinculado")
    expect(etiquetaVinculo("revocado")).toBe("Revocado")
    expect(tonoVinculo("vinculado")).toBe("success")
    expect(tonoVinculo("revocado")).toBe("danger")
    expect(tonoVinculo("ambiguo")).toBe("warning")
    expect(tonoVinculo("sin_vincular")).toBe("neutral")
    expect(tonoVinculo("sin_coincidencia")).toBe("neutral")
  })

  it("acceso a Facturación", () => {
    expect(etiquetaAcceso("corriente")).toBe("Por cuenta corriente")
    expect(etiquetaAcceso("excepcion")).toBe("Por excepción")
    expect(etiquetaAcceso("no")).toBe("No")
    expect(tonoAcceso("corriente")).toBe("success")
    expect(tonoAcceso("excepcion")).toBe("info")
    expect(tonoAcceso("no")).toBe("neutral")
  })

  it("método del vínculo: conocido con texto, desconocido crudo, null vacío", () => {
    expect(etiquetaMetodo("email_verificado")).toBe("Email verificado")
    expect(etiquetaMetodo("otp_email")).toBe("Código por email")
    expect(etiquetaMetodo("cookie_crm")).toBe("Portal de clientes")
    expect(etiquetaMetodo("operador")).toBe("Operador")
    expect(etiquetaMetodo("otro_metodo")).toBe("otro_metodo")
    expect(etiquetaMetodo(null)).toBeNull()
  })

  it("tipo de cuenta", () => {
    expect(etiquetaTipoCuenta("corriente")).toBe("Cuenta corriente")
    expect(etiquetaTipoCuenta("contado")).toBe("Contado")
    expect(etiquetaTipoCuenta(null)).toBe("—")
  })
})

describe("filtros y estado vacío", () => {
  it("las opciones de los Select nunca tienen value vacío (el DS no lo admite)", () => {
    for (const o of [...OPCIONES_VINCULO, ...OPCIONES_ACCESO, ...OPCIONES_PEDIDOS]) expect(o.value).not.toBe("")
    expect(OPCIONES_VINCULO.map((o) => o.value)).toEqual(["todos", "vinculados", "sin_vincular"])
    expect(OPCIONES_ACCESO.map((o) => o.value)).toEqual(["todos", "con", "sin"])
    expect(OPCIONES_PEDIDOS.map((o) => o.value)).toEqual(["todos", "con"])
  })

  it("hayFiltros: búsqueda con texto o algún filtro distinto de todos", () => {
    expect(hayFiltros(FILTROS_INICIALES)).toBe(false)
    expect(hayFiltros({ ...FILTROS_INICIALES, q: "   " })).toBe(false)
    expect(hayFiltros({ ...FILTROS_INICIALES, q: "ana" })).toBe(true)
    expect(hayFiltros({ ...FILTROS_INICIALES, pedidos: "con" })).toBe(true)
  })

  it("mensaje vacío según haya filtros", () => {
    expect(mensajeVacio(false)).toBe("Todavía no hay clientes registrados en la tienda.")
    expect(mensajeVacio(true)).toBe("No hay clientes que coincidan con su búsqueda.")
  })
})
