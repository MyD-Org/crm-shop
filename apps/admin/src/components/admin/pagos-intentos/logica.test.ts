import { describe, expect, it } from "vitest"
import {
  ETIQUETA_CLASE,
  SIN_DETALLE,
  etiquetaFila,
  fmtTasa,
  motivoIntento,
  nombreCuenta,
  opcionesDeCuenta,
  queryIntentos,
  queryResumen,
  tonoFila,
} from "./logica"

describe("fmtTasa", () => {
  it("formatea porcentajes y usa — cuando no hay denominador", () => {
    expect(fmtTasa(0.25)).toBe("25 %")
    expect(fmtTasa(0)).toBe("0 %")
    expect(fmtTasa(1)).toBe("100 %")
    expect(fmtTasa(0.1234)).toBe("12,3 %")
    expect(fmtTasa(null)).toBe("—")
    expect(fmtTasa(Number.NaN)).toBe("—")
  })
})

describe("queries", () => {
  it("la ventana siempre viaja; los filtros en 'todos' se omiten", () => {
    expect(queryIntentos({ start: 0, limit: 25 })).toBe("dias=7&start=0&limit=25")
    expect(
      queryIntentos({ dias: 30, proveedor: "payway", cuenta: "mdp", clase: "fallos", q: "  ana ", start: 25, limit: 25 }),
    ).toBe("dias=30&proveedor=payway&cuenta=mdp&clase=fallos&q=ana&start=25&limit=25")
    expect(queryIntentos({ proveedor: "todos", cuenta: "todas", clase: "todas", start: -3, limit: 10 })).toBe(
      "dias=7&start=0&limit=10",
    )
  })

  it("el resumen usa la misma ventana", () => {
    expect(queryResumen(undefined)).toBe("dias=7")
    expect(queryResumen(1)).toBe("dias=1")
  })
})

describe("etiquetas", () => {
  it("las seis clases tienen el rótulo del diseño", () => {
    expect(ETIQUETA_CLASE).toEqual({
      aprobado: "Aprobado",
      rechazo_banco: "Rechazo del banco",
      error_proveedor: "Error del proveedor",
      credenciales: "Credenciales rechazadas",
      reserva_abandonada: "Reserva abandonada",
      pendiente: "En curso",
    })
  })

  it("filas offline: 'Transferencia – pendiente/acreditada'", () => {
    expect(etiquetaFila({ clase: "offline", estado: "pendiente", proveedor: "transferencia" })).toBe("Transferencia – pendiente")
    expect(etiquetaFila({ clase: "offline", estado: "pagado", proveedor: "transferencia" })).toBe("Transferencia – acreditada")
    expect(etiquetaFila({ clase: "offline", estado: "pendiente", proveedor: "efectivo" })).toBe("Efectivo – pendiente")
    expect(etiquetaFila({ clase: "error_proveedor", estado: "fallido", proveedor: "mercadopago" })).toBe("Error del proveedor")
  })

  it("tonos: aprobado verde, errores en rojo", () => {
    expect(tonoFila({ clase: "aprobado", estado: "pagado" })).toBe("success")
    expect(tonoFila({ clase: "error_proveedor", estado: "fallido" })).toBe("danger")
    expect(tonoFila({ clase: "offline", estado: "pagado" })).toBe("success")
  })

  it("cuentas: sin_cuenta y nombres de sucursal", () => {
    const nombres = new Map([["igz", "Iguazú"]])
    expect(nombreCuenta("sin_cuenta")).toBe("Sin cuenta")
    expect(nombreCuenta(null)).toBe("Sin cuenta")
    expect(nombreCuenta("igz", nombres)).toBe("Iguazú")
    expect(nombreCuenta("mdp", nombres)).toBe("mdp")
    expect(opcionesDeCuenta(["mdp", "igz", "igz"], nombres)).toEqual([
      { value: "todas", label: "Todas las cuentas" },
      { value: "igz", label: "Iguazú" },
      { value: "mdp", label: "mdp" },
    ])
  })
})

describe("motivoIntento", () => {
  const base = { clase: "rechazo_banco", estado: "fallido", detalle: null, errorProveedor: null, errorStatus: null } as const

  it("el error del proveedor manda, con su HTTP", () => {
    expect(motivoIntento({ ...base, clase: "error_proveedor", errorProveedor: "internal_error", errorStatus: 500 })).toBe(
      "internal_error (HTTP 500)",
    )
    expect(motivoIntento({ ...base, clase: "error_proveedor", errorProveedor: "tiempo de espera agotado" })).toBe(
      "tiempo de espera agotado",
    )
  })

  it("sin error: el detalle; sin detalle: 'Sin detalle registrado'", () => {
    expect(motivoIntento({ ...base, detalle: "cc_rejected_other_reason" })).toBe("cc_rejected_other_reason")
    expect(motivoIntento(base)).toBe(SIN_DETALLE)
  })

  it("aprobado y en curso sin datos no muestran motivo", () => {
    expect(motivoIntento({ ...base, clase: "aprobado", estado: "pagado" })).toBeNull()
    expect(motivoIntento({ ...base, clase: "pendiente", estado: "pendiente" })).toBeNull()
  })
})
