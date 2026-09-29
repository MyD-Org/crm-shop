import { describe, expect, it } from "vitest"
import { MOTIVO_MAX } from "@/lib/pedidos-transiciones"
import {
  FILTRO_TODOS,
  leerAvisoFactura,
  mensajeAvisoFactura,
  separarAvisoFactura,
  MENSAJE_ERROR_GENERICO,
  interpretarRespuestaCambio,
  interpretarRespuestaFactura,
  motivoValido,
  opcionesDeDestino,
  esSinFactura,
  opcionesDeFiltro,
  opcionesDeFiltroEntrega,
  opcionesDeFiltroPago,
  opcionesDeFiltroSucursal,
  opcionesOtroEstado,
  pasosPedido,
  queryDeLista,
  siguientePaso,
  textoRango,
  verboSiguientePaso,
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
  it("ofrece SÓLO las transiciones permitidas desde el estado actual (envío)", () => {
    expect(opcionesDeDestino("pendiente", "envio").map((o) => o.value)).toEqual(["confirmado", "cancelado"])
    expect(opcionesDeDestino("entregado", "envio").map((o) => o.value)).toEqual([
      "en_camino",
      "preparacion",
      "confirmado",
    ])
  })

  it("entregado no ofrece cancelar; cancelado no ofrece nada", () => {
    expect(opcionesDeDestino("entregado", "envio").some((o) => o.value === "cancelado")).toBe(false)
    expect(opcionesDeDestino("cancelado", "envio")).toEqual([])
    expect(opcionesDeDestino("cancelado", "retiro")).toEqual([])
  })

  it("usa las etiquetas visibles", () => {
    expect(opcionesDeDestino("preparacion", "envio").map((o) => o.label)).toEqual([
      "En camino",
      "Entregado",
      "Confirmado",
      "Cancelado",
    ])
  })

  it("retiro: no ofrece en_camino como destino desde preparación ni desde entregado", () => {
    expect(opcionesDeDestino("preparacion", "retiro").map((o) => o.value)).toEqual([
      "entregado",
      "confirmado",
      "cancelado",
    ])
    expect(opcionesDeDestino("entregado", "retiro").map((o) => o.value)).toEqual(["preparacion", "confirmado"])
  })

  it("retiro: un pedido viejo en en_camino sigue ofreciendo sus destinos normales", () => {
    expect(opcionesDeDestino("en_camino", "retiro").map((o) => o.value)).toEqual([
      "entregado",
      "preparacion",
      "cancelado",
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

describe("interpretarRespuestaFactura (vincular / desvincular / buscar)", () => {
  const detalle = { id: "p1", estado: "confirmado" }

  it("2xx con cuerpo válido → ok", () => {
    expect(interpretarRespuestaFactura(200, detalle, (b) => typeof (b as { id?: unknown }).id === "string")).toEqual({
      tipo: "ok",
      valor: detalle,
    })
  })

  it("2xx con cuerpo que no valida → error genérico", () => {
    expect(interpretarRespuestaFactura(200, {}, () => false)).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_GENERICO })
  })

  it("409 → conflicto con el mensaje del servidor", () => {
    expect(interpretarRespuestaFactura(409, { error: "Otro." }, () => true)).toEqual({ tipo: "conflicto", mensaje: "Otro." })
  })

  it("422, 502 y 503 muestran el mensaje del servidor (vienen redactados)", () => {
    for (const status of [422, 502, 503]) {
      expect(interpretarRespuestaFactura(status, { error: "Mensaje." }, () => true)).toEqual({ tipo: "error", mensaje: "Mensaje." })
    }
  })

  it("500 o sin respuesta → genérico", () => {
    expect(interpretarRespuestaFactura(500, { error: "stack" }, () => true)).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_GENERICO })
    expect(interpretarRespuestaFactura(null, null, () => true)).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_GENERICO })
  })
})

describe("avisoFactura (mail de la factura)", () => {
  it("separa el aviso del detalle, sin dejarlo en el pedido", () => {
    const body = { id: "p1", estado: "confirmado", avisoFactura: { resultado: "enviado", destino: "an***@cliente.example" } }
    expect(separarAvisoFactura(body)).toEqual({
      detalle: { id: "p1", estado: "confirmado" },
      aviso: { resultado: "enviado", destino: "an***@cliente.example" },
    })
  })

  it("sin aviso o con otra forma → null", () => {
    expect(separarAvisoFactura({ id: "p1" }).aviso).toBeNull()
    expect(leerAvisoFactura({ resultado: "otro" })).toBeNull()
    expect(leerAvisoFactura("enviado")).toBeNull()
    expect(leerAvisoFactura({ resultado: "fallo", destino: 3 })).toEqual({ resultado: "fallo", destino: null })
  })

  it("mensajes para el operador", () => {
    expect(mensajeAvisoFactura({ resultado: "enviado", destino: "an***@cliente.example" })).toEqual({
      texto: "Enviamos la factura a an***@cliente.example.",
      ok: true,
    })
    expect(mensajeAvisoFactura({ resultado: "sin_email", destino: null }).ok).toBe(false)
    expect(mensajeAvisoFactura({ resultado: "sin_pdf", destino: "x" }).texto).toContain("PDF")
    expect(mensajeAvisoFactura({ resultado: "fallo", destino: "x" }).texto).toBe("No se pudo enviar la factura por mail.")
  })
})

describe("queryDeLista: filtros nuevos (q, entrega, pago, cola, vista)", () => {
  it("q/entrega/pago/cola se omiten cuando no vienen (el servidor los toma como 'sin filtro')", () => {
    expect(queryDeLista({ estado: "todos", start: 0, limit: 25 })).toBe("estado=todos&start=0&limit=25")
  })

  it("'todos' de entrega/pago tampoco viaja: sólo el de estado es explícito", () => {
    expect(queryDeLista({ estado: "todos", entrega: "todos", pago: "todos", start: 0, limit: 25 })).toBe(
      "estado=todos&start=0&limit=25",
    )
  })

  it("q se manda recortado y sólo si queda algo después del trim", () => {
    expect(queryDeLista({ estado: "todos", q: "  laura  ", start: 0, limit: 25 })).toBe(
      "estado=todos&q=laura&start=0&limit=25",
    )
    expect(queryDeLista({ estado: "todos", q: "   ", start: 0, limit: 25 })).toBe("estado=todos&start=0&limit=25")
  })

  it("entrega, pago y cola se agregan cuando vienen", () => {
    expect(
      queryDeLista({ estado: "todos", entrega: "envio", pago: "pendiente", cola: "pago", start: 0, limit: 25 }),
    ).toBe("estado=todos&entrega=envio&pago=pendiente&cola=pago&start=0&limit=25")
  })

  it("vista=tablero reemplaza start/limit por vista (el servidor los ignora igual)", () => {
    expect(queryDeLista({ estado: "todos", start: 40, limit: 25, vista: "tablero" })).toBe(
      "estado=todos&vista=tablero",
    )
  })
})

describe("opcionesDeFiltroEntrega / opcionesDeFiltroPago", () => {
  it("sin valores vacíos, 'todos' primero", () => {
    expect(opcionesDeFiltroEntrega().map((o) => o.value)).toEqual(["todos", "envio", "retiro"])
    expect(opcionesDeFiltroPago().map((o) => o.value)).toEqual(["todos", "pagado", "pendiente"])
  })
})

describe("pasosPedido / siguientePaso / verboSiguientePaso", () => {
  it("un envío tiene 5 pasos, un retiro se salta 'en_camino'", () => {
    expect(pasosPedido("envio")).toEqual(["pendiente", "confirmado", "preparacion", "en_camino", "entregado"])
    expect(pasosPedido("retiro")).toEqual(["pendiente", "confirmado", "preparacion", "entregado"])
  })

  it("siguientePaso avanza un solo casillero del camino feliz", () => {
    expect(siguientePaso("pendiente", "envio")).toBe("confirmado")
    expect(siguientePaso("confirmado", "envio")).toBe("preparacion")
    expect(siguientePaso("preparacion", "envio")).toBe("en_camino")
    expect(siguientePaso("en_camino", "envio")).toBe("entregado")
    // Retiro: de preparación va directo a entregado (sin "en_camino").
    expect(siguientePaso("preparacion", "retiro")).toBe("entregado")
  })

  it("entregado y cancelado no tienen siguiente paso", () => {
    expect(siguientePaso("entregado", "envio")).toBeNull()
    expect(siguientePaso("cancelado", "envio")).toBeNull()
  })

  it("verboSiguientePaso: 'entregado' cambia de verbo según el tipo de entrega", () => {
    expect(verboSiguientePaso("confirmado", "envio")).toBe("Confirmar pedido")
    expect(verboSiguientePaso("preparacion", "envio")).toBe("Pasar a preparación")
    expect(verboSiguientePaso("en_camino", "envio")).toBe("Marcar en camino")
    expect(verboSiguientePaso("entregado", "envio")).toBe("Marcar como entregado")
    expect(verboSiguientePaso("entregado", "retiro")).toBe("Marcar como retirado")
  })
})

describe("opcionesOtroEstado", () => {
  it("no repite el destino que ya se ofrece como botón primario", () => {
    const otros = opcionesOtroEstado("confirmado", "envio")
    expect(otros.map((o) => o.value)).not.toContain("preparacion")
    expect(otros.map((o) => o.value)).toEqual(["entregado", "pendiente", "cancelado"])
  })

  it("'cancelado' se etiqueta como acción, no como estado", () => {
    const otros = opcionesOtroEstado("pendiente", "envio")
    expect(otros.find((o) => o.value === "cancelado")?.label).toBe("Cancelar pedido")
  })

  it("un pedido cancelado no ofrece ningún otro estado", () => {
    expect(opcionesOtroEstado("cancelado", "envio")).toEqual([])
  })
})

describe("esSinFactura", () => {
  it("sólo es 'sin factura' un pedido ENTREGADO y sin factura vinculada", () => {
    expect(esSinFactura({ estado: "entregado", facturado: false })).toBe(true)
    expect(esSinFactura({ estado: "entregado", facturado: true })).toBe(false)
    expect(esSinFactura({ estado: "preparacion", facturado: false })).toBe(false)
  })
})

describe("filtro por sucursal", () => {
  it("'todas' o ausente se omite de la query; un slug viaja", () => {
    expect(queryDeLista({ estado: "todos", sucursal: "todas", start: 0, limit: 25 })).toBe("estado=todos&start=0&limit=25")
    expect(queryDeLista({ estado: "todos", start: 0, limit: 25 })).toBe("estado=todos&start=0&limit=25")
    expect(queryDeLista({ estado: "todos", sucursal: "igz", start: 0, limit: 25 })).toBe(
      "estado=todos&sucursal=igz&start=0&limit=25",
    )
  })

  it("las opciones arrancan con 'Todas las sucursales' y no tienen valores vacíos", () => {
    const o = opcionesDeFiltroSucursal([{ slug: "igz", nombre: "Iguazú" }])
    expect(o).toEqual([
      { value: "todas", label: "Todas las sucursales" },
      { value: "igz", label: "Iguazú" },
    ])
  })
})
