import { describe, expect, it, vi } from "vitest"
import {
  cuitConGuiones,
  elegirProductoPorCodigo,
  ErrorLecturaFactura,
  interpretarRespuestaFactura,
  leerFacturaTexto,
  netoCalculado,
  normalizarFactura,
  pedidoLecturaFactura,
  textoPorRenglones,
} from "./compras-leer-factura"

const entrada = {
  tipo_documento: "remito",
  cuit_emisor: null,
  razon_social_emisor: "Proveedor Ejemplo",
  numero_factura: "0099-00004724",
  fecha: "2026-11-04",
  vencimiento: null,
  descuento_general_pct: 40,
  lineas: [
    { codigo: "3430", descripcion: "ESTACA SOLAR", cantidad: 15, precio_unitario: 39093, iva_pct: null },
    { codigo: "6780", descripcion: "BAÑADOR", cantidad: 25, precio_unitario: 20833.9, iva_pct: 21 },
    { codigo: "X", descripcion: "basura", cantidad: 0, precio_unitario: 10, iva_pct: 21 },
  ],
  percepciones: [{ descripcion: "IIBB", importe: 0 }],
  subtotal_neto: 664338.5,
  total: 803849.59,
}

describe("normalizarFactura", () => {
  it("reparte el descuento general en el costo y descarta renglones inválidos", () => {
    const f = normalizarFactura(entrada)
    expect(f.lineas).toEqual([
      { codigo: "3430", descripcion: "ESTACA SOLAR", cantidad: 15, costo: 23455.8, ivaPct: null },
      { codigo: "6780", descripcion: "BAÑADOR", cantidad: 25, costo: 12500.34, ivaPct: 21 },
    ])
    expect(netoCalculado(f.lineas)).toBe(664345.5)
    expect(f.percepciones).toEqual([])
  })

  it("un remito no propone número de factura", () => {
    expect(normalizarFactura(entrada).numeroFactura).toBeNull()
    expect(normalizarFactura({ ...entrada, tipo_documento: "factura" }).numeroFactura).toBe("0099-00004724")
  })

  it("fechas inválidas quedan null y sin descuento el costo no cambia", () => {
    const f = normalizarFactura({ ...entrada, fecha: "04/11/2026", descuento_general_pct: null, subtotal_neto: null })
    expect(f.fecha).toBeNull()
    expect(f.lineas[0].costo).toBe(39093)
  })

  it("sin descuento informado, lo deduce del subtotal neto", () => {
    const f = normalizarFactura({
      ...entrada,
      descuento_general_pct: null,
      lineas: entrada.lineas.slice(0, 2),
      subtotal_neto: Math.round((15 * 39093 + 25 * 20833.9) * 0.6 * 100) / 100,
    })
    expect(f.descuentoGeneralPct).toBe(40)
    expect(f.lineas.map((l) => l.costo)).toEqual([23455.8, 12500.34])
  })

  it("subtotal igual a la suma: no inventa descuento", () => {
    const f = normalizarFactura({ ...entrada, descuento_general_pct: null, lineas: entrada.lineas.slice(0, 1), subtotal_neto: 15 * 39093 })
    expect(f.descuentoGeneralPct).toBeNull()
    expect(f.lineas[0].costo).toBe(39093)
  })

  it("tolera basura", () => {
    expect(normalizarFactura(null).lineas).toEqual([])
    expect(normalizarFactura({ lineas: "x" }).tipoDocumento).toBe("otro")
  })
})

describe("elegirProductoPorCodigo", () => {
  const p = (codigo: string | null) => ({ codigo })
  it("exacto o única referencia código-marca", () => {
    expect(elegirProductoPorCodigo("3430", [p("3430-TCM"), p("34300-X")])).toEqual(p("3430-TCM"))
    expect(elegirProductoPorCodigo("3430-tcm", [p("3430-TCM")])).toEqual(p("3430-TCM"))
    expect(elegirProductoPorCodigo("ABC", [p("ABC"), p("ABC-X")])).toEqual(p("ABC"))
  })
  it("ambiguo o ausente ⇒ null", () => {
    expect(elegirProductoPorCodigo("3430", [p("3430-TCM"), p("3430-OTRA")])).toBeNull()
    expect(elegirProductoPorCodigo("3430", [p(null), p("SIN")])).toBeNull()
    expect(elegirProductoPorCodigo("  ", [p("3430")])).toBeNull()
  })
})

describe("cuitConGuiones", () => {
  it("formatea 11 dígitos", () => {
    expect(cuitConGuiones("20123456789")).toBe("20-12345678-9")
    expect(cuitConGuiones("123")).toBe("123")
  })
})

describe("pedido y respuesta", () => {
  it("manda sólo texto y fuerza la herramienta", () => {
    const b = pedidoLecturaFactura("hola")
    expect(b.tool_choice).toEqual({ type: "tool", name: "registrar_factura" })
    expect(b.messages[0].content.map((c) => c.type)).toEqual(["text"])
  })
  it("sin tool_use o cortada por max_tokens ⇒ error para el usuario", () => {
    expect(() => interpretarRespuestaFactura({ stop_reason: "end_turn", content: [] })).toThrow(ErrorLecturaFactura)
    expect(() =>
      interpretarRespuestaFactura({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "registrar_factura", input: entrada }] }),
    ).toThrow(ErrorLecturaFactura)
  })
  it("leerFacturaTexto: sin clave 503, OK interpreta", async () => {
    await expect(leerFacturaTexto("x", { apiKey: " " })).rejects.toMatchObject({ estado: 503 })
    const fetch = vi.fn(async () =>
      Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "registrar_factura", input: entrada }] }),
    )
    const f = await leerFacturaTexto("texto", { apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch })
    expect(f.lineas).toHaveLength(2)
  })
})

describe("textoPorRenglones", () => {
  it("agrupa por altura y separa las celdas", () => {
    const t = textoPorRenglones([
      { str: "586,395.00", x: 500, y: 700, h: 8 },
      { str: "3430", x: 10, y: 700.5, h: 8 },
      { str: "15.00", x: 60, y: 699.8, h: 8 },
      { str: "Código", x: 10, y: 720, h: 8 },
    ])
    expect(t).toBe("Código\n3430 | 15.00 | 586,395.00")
  })
})
