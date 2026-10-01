import { describe, it, expect } from "vitest"
import { validarPagoManual, REFERENCIA_MAX } from "./pedido-pago-validacion"

// Cuerpo de "Registrar pago" de un pedido: monto > 0, fecha obligatoria, referencia opcional
// (<= 100) y comprobante opcional (uuid). Datos inventados.

const AHORA = new Date("2026-10-01T15:00:00Z")
const RECIBO = "11111111-1111-4111-8111-111111111111"

describe("validarPagoManual", () => {
  it("completo: normaliza el monto a 2 decimales y recorta la referencia", () => {
    const r = validarPagoManual({ monto: "150000.5", fecha: "2026-09-30", referencia: "  Op. 123  ", receiptId: RECIBO }, AHORA)
    expect(r).toEqual({ ok: true, monto: "150000.50", fecha: "2026-09-30", referencia: "Op. 123", receiptId: RECIBO })
  })

  it("sin referencia ni comprobante quedan en null", () => {
    expect(validarPagoManual({ monto: "10", fecha: "2026-10-01" }, AHORA)).toEqual({
      ok: true,
      monto: "10",
      fecha: "2026-10-01",
      referencia: null,
      receiptId: null,
    })
    expect(validarPagoManual({ monto: "10", fecha: "2026-10-01", referencia: "  ", receiptId: null }, AHORA)).toMatchObject({
      ok: true,
      referencia: null,
      receiptId: null,
    })
  })

  it.each([["0"], ["-5"], [""], [undefined], ["abc"], ["1.234"], [0]])("monto %s → 'Ingrese un monto mayor a cero'", (monto) => {
    const r = validarPagoManual({ monto, fecha: "2026-10-01" }, AHORA)
    expect(r).toEqual({ ok: false, campo: "monto", error: "Ingrese un monto mayor a cero" })
  })

  it("sin fecha → 'Indique la fecha del pago'", () => {
    expect(validarPagoManual({ monto: "10" }, AHORA)).toEqual({ ok: false, campo: "fecha", error: "Indique la fecha del pago" })
    expect(validarPagoManual({ monto: "10", fecha: "" }, AHORA)).toMatchObject({ ok: false, campo: "fecha" })
  })

  it("fecha futura o inexistente se rechaza con otro texto", () => {
    for (const fecha of ["2026-10-02", "2026-02-30", "ayer"]) {
      const r = validarPagoManual({ monto: "10", fecha }, AHORA)
      expect(r).toMatchObject({ ok: false, campo: "fecha" })
      expect((r as { error: string }).error).toContain("fecha del pago")
      expect((r as { error: string }).error).not.toBe("Indique la fecha del pago")
    }
  })

  it("referencia de más de 100 caracteres se rechaza; 100 justos pasa", () => {
    expect(validarPagoManual({ monto: "10", fecha: "2026-10-01", referencia: "x".repeat(REFERENCIA_MAX) }, AHORA).ok).toBe(true)
    expect(validarPagoManual({ monto: "10", fecha: "2026-10-01", referencia: "x".repeat(REFERENCIA_MAX + 1) }, AHORA)).toMatchObject({
      ok: false,
      campo: "referencia",
    })
  })

  it("comprobante que no es un uuid se rechaza", () => {
    expect(validarPagoManual({ monto: "10", fecha: "2026-10-01", receiptId: "no-es-uuid" }, AHORA)).toMatchObject({
      ok: false,
      campo: "receiptId",
    })
  })
})
