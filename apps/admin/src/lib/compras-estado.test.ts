import { describe, expect, it } from "vitest"
import type { BillLeida } from "./alegra-compras"
import { ErrorCompras } from "./compras-dinero"
import {
  ESTADOS_COMPRA,
  estadoTrasRecepcion,
  evaluarGuardas,
  puedeTransitar,
  transicionar,
  type CompraParaGuardas,
  type EstadoCompra,
} from "./compras-estado"
import { hashSnapshot, normalizarSnapshot } from "./compras-reparto"

const VALIDAS: Record<EstadoCompra, EstadoCompra[]> = {
  creando: ["pendiente", "anulada"],
  pendiente: ["parcial", "completa", "cerrada_faltante", "anulada", "anulada_en_alegra"],
  parcial: ["parcial", "completa", "cerrada_faltante", "anulada_en_alegra"],
  completa: [],
  cerrada_faltante: [],
  anulada: [],
  anulada_en_alegra: [],
}

describe("matriz de transiciones", () => {
  for (const desde of ESTADOS_COMPRA) {
    for (const hacia of ESTADOS_COMPRA) {
      const ok = VALIDAS[desde].includes(hacia)
      it(`${desde} -> ${hacia}: ${ok ? "válida" : "inválida"}`, () => {
        // cerrada_faltante exige tránsito restante: se lo damos para aislar la matriz
        const ctx = { transitoRestanteE5: BigInt(1) }
        expect(puedeTransitar(desde, hacia, ctx)).toBe(ok)
        if (ok) expect(transicionar(desde, hacia, ctx)).toBe(hacia)
        else expect(() => transicionar(desde, hacia, ctx)).toThrow(ErrorCompras)
      })
    }
  }

  it("cerrar con faltante sólo con tránsito restante", () => {
    expect(puedeTransitar("parcial", "cerrada_faltante", { transitoRestanteE5: BigInt(0) })).toBe(false)
    expect(puedeTransitar("pendiente", "cerrada_faltante", { transitoRestanteE5: BigInt(0) })).toBe(false)
    expect(puedeTransitar("parcial", "cerrada_faltante", { transitoRestanteE5: BigInt(1) })).toBe(true)
  })
})

describe("estadoTrasRecepcion", () => {
  it("parcial mientras falte mercadería", () => {
    expect(estadoTrasRecepcion([10_000, 5_000], [4_000, 5_000])).toBe("parcial")
  })
  it("completa cuando todo llegó", () => {
    expect(estadoTrasRecepcion([10_000, 5_000], [10_000, 5_000])).toBe("completa")
  })
})

// ── guardas ───────────────────────────────────────────────────────────────────────────────────────

const lineas = [
  { tipo: "item" as const, id: "10", nombre: "Cable", precioCentavos: 10_000, cantidadMilesimas: 4_000, taxIds: ["1"] },
  { tipo: "cat" as const, id: "5246", nombre: "Tránsito", precioCentavos: 60_000, cantidadMilesimas: 1_000, taxIds: ["1"] },
]
const TOTAL = 121_000

const bill = (p: Partial<BillLeida> = {}): BillLeida => ({
  id: "9001",
  estado: "open",
  numero: "A-1",
  proveedorId: "77",
  fecha: "2026-11-01",
  vencimiento: "2026-12-01",
  almacenId: "alm-1",
  observaciones: null,
  totalCentavos: TOTAL,
  pagadoCentavos: 0,
  saldoCentavos: TOTAL,
  pagos: [],
  retenciones: [],
  lineas,
  raw: {},
  ...p,
})

const compra = (p: Partial<CompraParaGuardas> = {}): CompraParaGuardas => ({
  snapshotHash: hashSnapshot(normalizarSnapshot(lineas, TOTAL)),
  totalEsperadoCentavos: TOTAL,
  almacenId: "alm-1",
  transitoPendiente: true,
  categoriaTransitoId: "5246",
  ...p,
})

describe("evaluarGuardas", () => {
  it("bill íntegra: ok", () => {
    expect(evaluarGuardas(bill(), compra())).toEqual({ ok: true })
  })

  it("estado distinto de open", () => {
    for (const estado of ["void", "draft", "closed"]) {
      const r = evaluarGuardas(bill({ estado }), compra())
      expect(r).toMatchObject({ ok: false, codigo: "estado_no_abierto" })
    }
  })

  it("con un pago registrado: bloquea con el aviso del spec", () => {
    const r = evaluarGuardas(bill({ pagos: [{ id: "1", numero: null, montoCentavos: 100 }] }), compra())
    expect(r).toEqual({
      ok: false,
      codigo: "con_pagos",
      mensaje: "Esta factura ya tiene un pago registrado en Alegra. Registre la recepción directamente en Alegra.",
    })
  })

  it("con retenciones: bloquea", () => {
    const r = evaluarGuardas(bill({ retenciones: [{}] }), compra())
    expect(r).toMatchObject({ ok: false, codigo: "con_retenciones" })
  })

  it("líneas editadas en Alegra: bloquea y ofrece actualizar", () => {
    const editadas = [{ ...lineas[0], cantidadMilesimas: 5_000 }, lineas[1]]
    const r = evaluarGuardas(bill({ lineas: editadas }), compra())
    expect(r).toMatchObject({ ok: false, codigo: "modificada_en_alegra" })
    if (!r.ok) expect(r.mensaje).toMatch(/cambió en Alegra/)
  })

  it("el hash ignora el orden y los nombres de las líneas", () => {
    const r = evaluarGuardas(bill({ lineas: [{ ...lineas[1], nombre: "Otro" }, lineas[0]] }), compra())
    expect(r).toEqual({ ok: true })
  })

  it("total distinto al esperado con las mismas líneas: bloquea", () => {
    const r = evaluarGuardas(bill({ totalCentavos: TOTAL + 100 }), compra())
    expect(r).toMatchObject({ ok: false, codigo: "modificada_en_alegra" })
  })

  it("total esperado de la compra distinto del de la bill (aun con snapshot coincidente)", () => {
    const r = evaluarGuardas(bill(), compra({ totalEsperadoCentavos: TOTAL + 5 }))
    expect(r).toMatchObject({ ok: false, codigo: "total_inesperado" })
  })

  it("almacén distinto", () => {
    expect(evaluarGuardas(bill({ almacenId: "alm-2" }), compra())).toMatchObject({ ok: false, codigo: "almacen_distinto" })
  })

  it("sin línea de tránsito aunque quede tránsito pendiente", () => {
    const sinTransito = [lineas[0]]
    const c = compra({ snapshotHash: hashSnapshot(normalizarSnapshot(sinTransito, TOTAL)) })
    expect(evaluarGuardas(bill({ lineas: sinTransito }), c)).toMatchObject({ ok: false, codigo: "sin_transito" })
    expect(evaluarGuardas(bill({ lineas: sinTransito }), { ...c, transitoPendiente: false })).toEqual({ ok: true })
  })

  it("el orden de las guardas: pagos antes que snapshot", () => {
    const r = evaluarGuardas(
      bill({ pagos: [{ id: "1", numero: null, montoCentavos: 1 }], lineas: [lineas[0]] }),
      compra(),
    )
    expect(r).toMatchObject({ codigo: "con_pagos" })
  })
})
