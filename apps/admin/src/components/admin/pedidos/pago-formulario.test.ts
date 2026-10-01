import { describe, expect, it } from "vitest"
import type { ComprobantePedidoDto } from "@/lib/pedidos-repo"
import {
  SIN_COMPROBANTE,
  cuerpoRegistrarPago,
  etiquetaComprobante,
  formularioPagoInicial,
  hoyArgentina,
  opcionesComprobante,
} from "./pago-formulario"

// Lógica pura del formulario "Registrar pago" (esta app no tiene jsdom: lo que se puede
// equivocar se prueba acá y el componente queda como cableado). Datos inventados.

const comp = (over: Partial<ComprobantePedidoDto> = {}): ComprobantePedidoDto => ({
  id: "c1",
  monto: 1500,
  fecha: "2026-09-28",
  estado: "pending",
  subidoEn: "2026-09-28T15:00:00.000Z",
  tieneArchivo: true,
  mime: "application/pdf",
  nombreArchivo: "transferencia.pdf",
  ...over,
})

describe("hoyArgentina", () => {
  it("usa el día de Argentina, no el de UTC (23:30 AR ya es el día siguiente en UTC)", () => {
    expect(hoyArgentina(new Date("2026-10-02T02:30:00Z"))).toBe("2026-10-01")
    expect(hoyArgentina(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-01")
  })
})

describe("formularioPagoInicial", () => {
  const hoy = new Date("2026-10-01T15:00:00Z")

  it("sin comprobantes: monto = total del pedido, fecha de hoy y sin comprobante", () => {
    expect(formularioPagoInicial({ total: 1210 }, [], hoy)).toEqual({
      monto: "1210.00",
      fecha: "2026-10-01",
      referencia: "",
      comprobante: SIN_COMPROBANTE,
    })
  })

  it("con un comprobante pendiente: lo preselecciona y precarga su monto y su fecha", () => {
    const f = formularioPagoInicial({ total: 1210 }, [comp({ id: "c9", monto: 1210.5, fecha: "2026-09-30" })], hoy)
    expect(f).toEqual({ monto: "1210.50", fecha: "2026-09-30", referencia: "", comprobante: "c9" })
  })

  it("con varios, el último (la lista viene del más nuevo al más viejo) y sólo si está pendiente", () => {
    const f = formularioPagoInicial({ total: 1 }, [comp({ id: "nuevo" }), comp({ id: "viejo", monto: 7 })], hoy)
    expect(f.comprobante).toBe("nuevo")
    const soloCargado = formularioPagoInicial({ total: 1210 }, [comp({ estado: "loaded" })], hoy)
    expect(soloCargado.comprobante).toBe(SIN_COMPROBANTE)
    expect(soloCargado.monto).toBe("1210.00")
  })
})

describe("opcionesComprobante / etiquetaComprobante", () => {
  it("siempre ofrece 'Sin comprobante' primero y describe cada comprobante en usted", () => {
    const opciones = opcionesComprobante([comp({ id: "c1" }), comp({ id: "c2", estado: "loaded", monto: 800 })])
    expect(opciones[0]).toEqual({ value: SIN_COMPROBANTE, label: "Sin comprobante" })
    expect(opciones.map((o) => o.value)).toEqual([SIN_COMPROBANTE, "c1", "c2"])
    expect(opciones[1].label).toBe(etiquetaComprobante(comp({ id: "c1" })))
    expect(etiquetaComprobante(comp())).toContain("28/09/2026")
    expect(etiquetaComprobante(comp())).toContain("Por revisar")
    expect(etiquetaComprobante(comp({ estado: "loaded" }))).toContain("Ya cargado")
  })
})

describe("cuerpoRegistrarPago", () => {
  it("arma el cuerpo: coma decimal a punto, referencia vacía fuera, sin comprobante sin receiptId", () => {
    expect(cuerpoRegistrarPago({ monto: " 1210,50 ", fecha: "2026-10-01", referencia: "  ", comprobante: SIN_COMPROBANTE })).toEqual({
      pagado: true,
      monto: "1210.50",
      fecha: "2026-10-01",
    })
    expect(cuerpoRegistrarPago({ monto: "10", fecha: "2026-10-01", referencia: " Op. 1 ", comprobante: "c1" })).toEqual({
      pagado: true,
      monto: "10",
      fecha: "2026-10-01",
      referencia: "Op. 1",
      receiptId: "c1",
    })
  })

  it("un monto con separador de miles no se 'adivina': se manda tal cual y lo rechaza el servidor", () => {
    expect(cuerpoRegistrarPago({ monto: "1.210,50", fecha: "2026-10-01", referencia: "", comprobante: SIN_COMPROBANTE }).monto).toBe("1.210,50")
  })
})
