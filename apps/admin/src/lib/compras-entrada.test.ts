import { describe, expect, it } from "vitest"
import { validarEntradaCompra } from "./compras-entrada"

const base = () => ({
  cuenta: "mdp",
  idempotencyKey: "clave-de-prueba-1",
  proveedor: { id: "77", nombre: "Proveedor Ejemplo", cuit: "30-00000000-0" },
  numeroFactura: "0001-00000123",
  fecha: "2026-11-10",
  vencimiento: "2026-12-10",
  observaciones: "Pedido de noviembre",
  items: [{ alegraId: "p1", cantidad: 10, costo: 100.5, ivaPorcentaje: 21 }],
  percepciones: [{ nombre: "Ingresos brutos Buenos Aires", importe: 30, certificado: "C-1" }],
})

describe("validarEntradaCompra", () => {
  it("convierte pesos a centavos y cantidades a milésimas", () => {
    const r = validarEntradaCompra({ ...base(), items: [{ alegraId: "p1", cantidad: "2.5", costo: "33.33", ivaPorcentaje: 10.5 }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items[0]).toMatchObject({ alegraId: "p1", cantidadMilesimas: 2500, costoCentavos: 3333, ivaPorcentaje: 10.5 })
    expect(r.value.percepciones[0]).toMatchObject({ nombre: "Ingresos brutos Buenos Aires", importeCentavos: 3000, certificado: "C-1" })
  })

  it("acepta una entrada sin percepciones ni observaciones", () => {
    const r = validarEntradaCompra({ ...base(), percepciones: undefined, observaciones: undefined })
    expect(r.ok).toBe(true)
  })

  it.each([
    ["sin ítems", { items: [] }],
    ["cantidad cero", { items: [{ alegraId: "p1", cantidad: 0, costo: 10, ivaPorcentaje: 21 }] }],
    ["cantidad negativa", { items: [{ alegraId: "p1", cantidad: -1, costo: 10, ivaPorcentaje: 21 }] }],
    ["cantidad con 4 decimales", { items: [{ alegraId: "p1", cantidad: 1.2345, costo: 10, ivaPorcentaje: 21 }] }],
    ["costo negativo", { items: [{ alegraId: "p1", cantidad: 1, costo: -1, ivaPorcentaje: 21 }] }],
    ["costo con 3 decimales", { items: [{ alegraId: "p1", cantidad: 1, costo: 1.005, ivaPorcentaje: 21 }] }],
    ["IVA no soportado", { items: [{ alegraId: "p1", cantidad: 1, costo: 10, ivaPorcentaje: 13 }] }],
    ["descuento por línea", { items: [{ alegraId: "p1", cantidad: 1, costo: 10, ivaPorcentaje: 21, discount: 5 }] }],
    ["descuento en español", { items: [{ alegraId: "p1", cantidad: 1, costo: 10, ivaPorcentaje: 21, descuento: 5 }] }],
    [
      "producto repetido",
      {
        items: [
          { alegraId: "p1", cantidad: 1, costo: 10, ivaPorcentaje: 21 },
          { alegraId: "p1", cantidad: 2, costo: 10, ivaPorcentaje: 21 },
        ],
      },
    ],
    ["sin número", { numeroFactura: "  " }],
    ["fecha inválida", { fecha: "10/11/2026" }],
    ["vencimiento anterior a la fecha", { vencimiento: "2026-11-01" }],
    ["sin proveedor", { proveedor: { id: "", nombre: "" } }],
    ["sin cuenta", { cuenta: "" }],
    ["clave de idempotencia corta", { idempotencyKey: "x" }],
    ["percepción sin importe", { percepciones: [{ nombre: "IIBB", importe: 0 }] }],
    ["percepción sin nombre", { percepciones: [{ nombre: "", importe: 5 }] }],
    ["percepción repetida", { percepciones: [{ nombre: "IIBB", importe: 5 }, { nombre: "IIBB", importe: 6 }] }],
  ])("rechaza %s con un mensaje en usted", (_n, parche) => {
    const r = validarEntradaCompra({ ...base(), ...parche })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.length).toBeGreaterThan(10)
    expect(r.error).not.toMatch(/\b(tu|tus|vos|podés|ingresá)\b/i)
  })

  it("rechaza un cuerpo que no es un objeto", () => {
    expect(validarEntradaCompra(null).ok).toBe(false)
    expect(validarEntradaCompra("x").ok).toBe(false)
  })
})
