import { describe, it, expect } from "vitest"
import { decimalCanonico, validarCambios, MSG_COEF, MSG_NOMBRE, MSG_SIN_CAMBIOS, MAX_CAMBIOS } from "./precios-online-cambios"

// B.8: validación de los cambios de precios online. Datos inventados.

const ID = "11111111-1111-4111-8111-111111111111"
const CAT = "22222222-2222-4222-8222-222222222222"

describe("decimalCanonico", () => {
  it("normaliza a los decimales pedidos", () => {
    expect(decimalCanonico(1.5, 4)).toBe("1.5000")
    expect(decimalCanonico("1.25", 4)).toBe("1.2500")
    expect(decimalCanonico("1", 4)).toBe("1.0000")
    expect(decimalCanonico("1.50000", 4)).toBe("1.5000")
  })
  it("rechaza lo que no es decimal o tiene más de 4 decimales significativos", () => {
    for (const v of ["", "abc", "1,5", "-1", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "1.23456", {}]) {
      expect(decimalCanonico(v, 4), String(v)).toBeNull()
    }
  })
})

describe("validarCambios: coeficiente", () => {
  const crear = (coeficiente: unknown) => validarCambios([{ op: "crearLista", nombre: "Lista A", coeficiente }])

  it("acepta 1 y más", () => {
    expect(crear(1)).toMatchObject({ ok: true, cambios: [{ op: "crearLista", nombre: "Lista A", coeficiente: "1.0000" }] })
    expect(crear("1.6")).toMatchObject({ ok: true })
  })
  it.each([0.99, "0.5", 0, -2, "", "abc", null, Number.NaN])("rechaza %s con 'mayor o igual a 1'", (v) => {
    expect(crear(v)).toEqual({ ok: false, campo: "cambios[0].coeficiente", error: MSG_COEF })
    expect(MSG_COEF).toBe("El coeficiente debe ser mayor o igual a 1.")
  })
  it("rechaza demasiados decimales y coeficientes absurdos", () => {
    expect(crear("1.23456")).toMatchObject({ ok: false, error: "El coeficiente admite hasta 4 decimales." })
    expect(crear(1000)).toMatchObject({ ok: false })
  })
})

describe("validarCambios: forma", () => {
  it("rechaza vacío, no arreglo y demasiados cambios", () => {
    expect(validarCambios([])).toEqual({ ok: false, campo: "cambios", error: MSG_SIN_CAMBIOS })
    expect(validarCambios({})).toMatchObject({ ok: false })
    expect(validarCambios(Array.from({ length: MAX_CAMBIOS + 1 }, () => ({ op: "setReferencia", listaId: ID })))).toMatchObject({ ok: false })
  })
  it("rechaza op desconocida y la op interna restaurarLista", () => {
    expect(validarCambios([{ op: "x" }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "restaurarLista", lista: {}, overrides: [] }])).toMatchObject({ ok: false })
  })
  it("exige nombre", () => {
    expect(validarCambios([{ op: "crearLista", nombre: "  ", coeficiente: 1.5 }])).toMatchObject({ ok: false, error: MSG_NOMBRE })
  })
  it("editarLista exige al menos un campo y uuid", () => {
    expect(validarCambios([{ op: "editarLista", listaId: ID }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "editarLista", listaId: "no-uuid", activa: false }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "editarLista", listaId: ID, activa: false, coeficiente: "1.2" }])).toMatchObject({
      ok: true,
      cambios: [{ op: "editarLista", listaId: ID, activa: false, coeficiente: "1.2000" }],
    })
  })
})

describe("validarCambios: overrides", () => {
  it("marca o categoría, excluyentes, y la marca se normaliza", () => {
    expect(validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "marca", marca: "  Marca X ", coeficiente: 1.5 }])).toMatchObject({
      ok: true,
      cambios: [{ op: "upsertOverride", tipo: "marca", marca: "marca x", coeficiente: "1.5000" }],
    })
    expect(validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "categoria", categoriaId: CAT, coeficiente: 1.3 }])).toMatchObject({ ok: true })
    // Una marca con categoriaId (o al revés) no se mezcla: se descarta lo que no corresponde al tipo.
    const r = validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "marca", marca: "x", categoriaId: CAT, coeficiente: 1.5 }])
    expect(r.ok && (r.cambios[0] as Record<string, unknown>).categoriaId).toBeFalsy()
    expect(validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "marca", marca: "  ", coeficiente: 1.5 }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "categoria", coeficiente: 1.5 }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "otro", coeficiente: 1.5 }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "upsertOverride", listaId: ID, tipo: "marca", marca: "x", coeficiente: 0.9 }])).toMatchObject({
      ok: false,
      error: MSG_COEF,
    })
  })
})

describe("validarCambios: umbrales", () => {
  it("> 0, hasta 2 decimales; al menos uno", () => {
    expect(validarCambios([{ op: "setUmbrales", confirmacionPct: 15, retencionPct: "7.5" }])).toMatchObject({
      ok: true,
      cambios: [{ op: "setUmbrales", confirmacionPct: "15.00", retencionPct: "7.50" }],
    })
    expect(validarCambios([{ op: "setUmbrales" }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setUmbrales", retencionPct: 0 }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setUmbrales", retencionPct: -5 }])).toMatchObject({ ok: false })
  })
})

describe("validarCambios: monto mínimo de cuotas", () => {
  const cond = (extra: Record<string, unknown>) => [{ op: "setCondicion", medioSlug: "tarjeta", listaId: ID, ...extra }]

  it("acepta un mínimo en filas de cuotas y lo normaliza a dos decimales", () => {
    expect(validarCambios(cond({ cuotas: 6, montoMinimo: "60000" }))).toMatchObject({
      ok: true,
      cambios: [{ cuotas: 6, montoMinimo: "60000.00" }],
    })
    expect(validarCambios(cond({ cuotas: 6, montoMinimo: 80000.5 }))).toMatchObject({
      ok: true,
      cambios: [{ montoMinimo: "80000.50" }],
    })
    expect(validarCambios(cond({ cuotas: 6, montoMinimo: 0 }))).toMatchObject({ ok: true, cambios: [{ montoMinimo: "0.00" }] })
  })

  it("ausente o null = sin mínimo", () => {
    expect(validarCambios(cond({ cuotas: 6 }))).toMatchObject({ ok: true, cambios: [{ montoMinimo: null }] })
    expect(validarCambios(cond({ cuotas: 6, montoMinimo: null }))).toMatchObject({ ok: true, cambios: [{ montoMinimo: null }] })
  })

  it("rechaza negativo, no numérico, más de dos decimales y mínimo en pago único", () => {
    for (const m of [-1, "-5", "abc", "10.123", NaN, Infinity, {}]) {
      expect(validarCambios(cond({ cuotas: 6, montoMinimo: m }))).toMatchObject({ ok: false })
    }
    expect(validarCambios(cond({ cuotas: null, montoMinimo: "1000" }))).toMatchObject({ ok: false })
    expect(validarCambios(cond({ montoMinimo: "1000" }))).toMatchObject({ ok: false })
  })

  it("una baja (listaId null) ignora el mínimo", () => {
    expect(
      validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: null, montoMinimo: "1000" }]),
    ).toMatchObject({ ok: true, cambios: [{ listaId: null, montoMinimo: null }] })
  })
})

describe("validarCambios: condiciones de medios de pago", () => {
  it("medio + lista (o null para quitar); cuotas null o entero 2..24", () => {
    expect(validarCambios([{ op: "setCondicion", medioSlug: "transferencia", cuotas: null, listaId: ID }])).toMatchObject({
      ok: true,
      cambios: [{ op: "setCondicion", medioSlug: "transferencia", cuotas: null, listaId: ID }],
    })
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: null }])).toMatchObject({ ok: true })
    // `cuotas` ausente = pago único.
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", listaId: ID }])).toMatchObject({
      ok: true,
      cambios: [{ cuotas: null }],
    })
  })

  it("rechaza slug inválido, cuotas fuera de rango o no enteras y lista que no es uuid", () => {
    expect(validarCambios([{ op: "setCondicion", medioSlug: "Medio Pago", cuotas: null, listaId: ID }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 1, listaId: ID }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 25, listaId: ID }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 2.5, listaId: ID }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: null, listaId: "x" }])).toMatchObject({ ok: false })
    expect(validarCambios([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: null }])).toMatchObject({ ok: false })
  })
})
