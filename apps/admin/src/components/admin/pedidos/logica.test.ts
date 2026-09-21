import { describe, expect, it } from "vitest"
import { MOTIVO_MAX } from "@/lib/pedidos-transiciones"
import {
  FILTRO_TODOS,
  MENSAJE_ERROR_GENERICO,
  interpretarRespuestaCambio,
  motivoValido,
  opcionesDeDestino,
  opcionesDeFiltro,
  queryDeLista,
  textoRango,
} from "./logica"

describe("queryDeLista", () => {
  it("arma estado + start + limit", () => {
    expect(queryDeLista({ estado: "pendiente", start: 25, limit: 25 })).toBe(
      "estado=pendiente&start=25&limit=25",
    )
  })

  it("'todos' viaja explícito (la API lo acepta como sin filtro; vacío sería 400)", () => {
    expect(queryDeLista({ estado: FILTRO_TODOS, start: 0, limit: 25 })).toBe(
      "estado=todos&start=0&limit=25",
    )
  })

  it("nunca manda un start negativo ni fraccionario", () => {
    expect(queryDeLista({ estado: "todos", start: -5, limit: 25 })).toBe("estado=todos&start=0&limit=25")
    expect(queryDeLista({ estado: "todos", start: 2.7, limit: 25 })).toBe("estado=todos&start=2&limit=25")
  })
})

describe("opcionesDeFiltro", () => {
  it("Todos + los 6 estados, en orden, sin valores vacíos (el Select del DS no los admite)", () => {
    const opciones = opcionesDeFiltro()
    expect(opciones.map((o) => o.value)).toEqual([
      "todos",
      "pendiente",
      "confirmado",
      "preparacion",
      "en_camino",
      "entregado",
      "cancelado",
    ])
    expect(opciones.map((o) => o.label)).toEqual([
      "Todos",
      "Pendiente",
      "Confirmado",
      "En preparación",
      "En camino",
      "Entregado",
      "Cancelado",
    ])
    expect(opciones.every((o) => o.value !== "")).toBe(true)
  })
})

describe("opcionesDeDestino", () => {
  it("ofrece SÓLO las transiciones permitidas desde el estado actual", () => {
    expect(opcionesDeDestino("pendiente").map((o) => o.value)).toEqual(["confirmado", "cancelado"])
    expect(opcionesDeDestino("entregado").map((o) => o.value)).toEqual([
      "en_camino",
      "preparacion",
      "confirmado",
    ])
  })

  it("entregado no ofrece cancelar; cancelado no ofrece nada", () => {
    expect(opcionesDeDestino("entregado").some((o) => o.value === "cancelado")).toBe(false)
    expect(opcionesDeDestino("cancelado")).toEqual([])
  })

  it("usa las etiquetas visibles", () => {
    expect(opcionesDeDestino("preparacion").map((o) => o.label)).toEqual([
      "En camino",
      "Entregado",
      "Confirmado",
      "Cancelado",
    ])
  })
})

describe("textoRango", () => {
  it("primera página, página parcial y lista vacía", () => {
    expect(textoRango(0, 25, 40)).toBe("1–25 de 40")
    expect(textoRango(25, 15, 40)).toBe("26–40 de 40")
    expect(textoRango(0, 0, 0)).toBe("0")
  })

  it("una página más allá del final no inventa un rango", () => {
    expect(textoRango(100, 0, 40)).toBe("0 de 40")
  })
})

describe("motivoValido", () => {
  it("vacío o sólo espacios no vale (el botón queda deshabilitado)", () => {
    expect(motivoValido("")).toBe(false)
    expect(motivoValido("   \n ")).toBe(false)
  })

  it("1..500 caracteres después del trim", () => {
    expect(motivoValido("x")).toBe(true)
    expect(motivoValido("  Cliente desistió  ")).toBe(true)
    expect(motivoValido("a".repeat(MOTIVO_MAX))).toBe(true)
    expect(motivoValido("a".repeat(MOTIVO_MAX + 1))).toBe(false)
    // Los espacios de los bordes no cuentan: el servidor mide igual.
    expect(motivoValido(` ${"a".repeat(MOTIVO_MAX)} `)).toBe(true)
  })
})

describe("interpretarRespuestaCambio", () => {
  const pedido = { id: "p1", estado: "confirmado" }

  it("200 con cuerpo → ok", () => {
    expect(interpretarRespuestaCambio(200, pedido)).toEqual({ tipo: "ok", pedido })
  })

  it("200 sin un pedido en el cuerpo → error genérico (no se pisa el estado con basura)", () => {
    expect(interpretarRespuestaCambio(200, null)).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_GENERICO })
    expect(interpretarRespuestaCambio(200, { ok: true })).toEqual({
      tipo: "error",
      mensaje: MENSAJE_ERROR_GENERICO,
    })
  })

  it("409 → conflicto con el mensaje del servidor (la UI recarga el pedido)", () => {
    const error = "El pedido fue modificado por otra persona. Actualice la página e inténtelo nuevamente."
    expect(interpretarRespuestaCambio(409, { error, code: "conflict", estadoActual: "confirmado" })).toEqual({
      tipo: "conflicto",
      mensaje: error,
    })
  })

  it("400/404/422 → el {error} del servidor tal cual", () => {
    expect(interpretarRespuestaCambio(422, { error: "Indique el motivo de la cancelación.", code: "reason_required" })).toEqual({
      tipo: "error",
      mensaje: "Indique el motivo de la cancelación.",
    })
    expect(interpretarRespuestaCambio(404, { error: "No encontrado", code: "not_found" })).toEqual({
      tipo: "error",
      mensaje: "No encontrado",
    })
  })

  it("500, red caída o cuerpo ilegible → mensaje genérico", () => {
    expect(interpretarRespuestaCambio(500, { error: "stack trace interno" })).toEqual({
      tipo: "error",
      mensaje: MENSAJE_ERROR_GENERICO,
    })
    expect(interpretarRespuestaCambio(null, null)).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_GENERICO })
    expect(interpretarRespuestaCambio(422, "<html>")).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_GENERICO })
    expect(interpretarRespuestaCambio(409, {})).toEqual({ tipo: "conflicto", mensaje: MENSAJE_ERROR_GENERICO })
  })

  it("el genérico es el del spec, con tilde", () => {
    expect(MENSAJE_ERROR_GENERICO).toBe("No se pudo actualizar el pedido. Inténtelo nuevamente.")
  })
})
