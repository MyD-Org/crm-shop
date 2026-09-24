import { describe, expect, it, vi } from "vitest"
import type { AlegraFacturaResumen } from "./alegra"
import { numeroFacturaCoincide, resolverFactura, validarFactura } from "./factura-vincular"

// Lógica pura de "Vincular factura": qué factura corresponde a lo que tipeó el operador y si
// se puede vincular al pedido. Datos inventados.

const f = (over: Partial<AlegraFacturaResumen> = {}): AlegraFacturaResumen => ({
  alegraId: "7040",
  numero: "00201-00007040",
  fecha: "2026-09-20",
  total: 1210,
  estado: "open",
  clienteAlegraId: "55",
  clienteNombre: "Cliente Ejemplo SA",
  ...over,
})

describe("numeroFacturaCoincide", () => {
  it.each([
    ["00201-00007040", "00201-00007040", true],
    ["00201-00007040", " 00201-00007040 ", true],
    ["00201-00007040", "201-7040", true],
    ["00201-00007040", "0020100007040", true],
    ["00201-00007040", "7040", true],
    ["FC A 00201-00007040", "00201-00007040", true],
    ["fc a 00201-00007040", "A 00201-00007040", true],
    ["00201-00007040", "00202-00007040", false],
    ["00201-00007040", "00201-00007041", false],
    ["00201-00007040", "704", false],
    ["00201-00007040", "", false],
    ["00201-00007040", "---", false],
    [null, "7040", false],
  ])("%s vs %s → %s", (numero, tipeado, esperado) => {
    expect(numeroFacturaCoincide(numero, tipeado)).toBe(esperado)
  })
})

describe("validarFactura", () => {
  it("abierta o cerrada, sin cliente en el pedido → ok, cliente sin verificar", () => {
    expect(validarFactura(f(), null)).toEqual({ ok: true, clienteVerificado: false })
    expect(validarFactura(f({ estado: "closed" }), null)).toEqual({ ok: true, clienteVerificado: false })
  })

  it("mismo cliente → ok verificado", () => {
    expect(validarFactura(f(), "55")).toEqual({ ok: true, clienteVerificado: true })
  })

  it("borrador y anulada no", () => {
    expect(validarFactura(f({ estado: "draft" }), null)).toEqual({ ok: false, motivo: "borrador" })
    expect(validarFactura(f({ estado: "void" }), "55")).toEqual({ ok: false, motivo: "anulada" })
  })

  it("otro cliente no (y una factura sin cliente tampoco, si el pedido tiene uno)", () => {
    expect(validarFactura(f({ clienteAlegraId: "56" }), "55")).toEqual({ ok: false, motivo: "otro_cliente" })
    expect(validarFactura(f({ clienteAlegraId: null }), "55")).toEqual({ ok: false, motivo: "otro_cliente" })
  })
})

describe("resolverFactura", () => {
  const deps = (porNumero: AlegraFacturaResumen[][] = [], porId: AlegraFacturaResumen | null = null) => {
    const colas = [...porNumero]
    return {
      porNumero: vi.fn(async () => colas.shift() ?? []),
      porId: vi.fn(async () => porId),
    }
  }

  it("una coincidencia exacta en la búsqueda por número → esa, con una sola request", async () => {
    const d = deps([[f(), f({ alegraId: "1", numero: "00201-00000001" })]])
    expect(await resolverFactura("00201-00007040", null, d)).toEqual({ kind: "ok", factura: f() })
    expect(d.porNumero).toHaveBeenCalledTimes(1)
    expect(d.porId).not.toHaveBeenCalled()
  })

  it("filtro ignorado por Alegra: no se toma una factura que no coincide", async () => {
    const d = deps([[f({ alegraId: "1", numero: "00201-00000001" })]])
    expect(await resolverFactura("00201-00007040", null, d)).toEqual({ kind: "no_encontrada" })
  })

  it("sin coincidencias y con cliente → reintenta entre las facturas del cliente", async () => {
    const d = deps([[], [f()]])
    expect(await resolverFactura("7040", "55", d)).toEqual({ kind: "ok", factura: f() })
    expect(d.porNumero).toHaveBeenNthCalledWith(2, "7040", { clientId: "55" })
  })

  it("varias coincidencias: si una sola es del cliente del pedido, esa", async () => {
    const otra = f({ alegraId: "9", clienteAlegraId: "99", numero: "00301-00007040" })
    const d = deps([[otra, f()]])
    expect(await resolverFactura("7040", "55", d)).toEqual({ kind: "ok", factura: f() })
  })

  it("varias coincidencias sin forma de elegir → ambigua", async () => {
    const otra = f({ alegraId: "9", numero: "00301-00007040" })
    const d = deps([[otra, f()]])
    expect(await resolverFactura("7040", null, d)).toEqual({ kind: "ambigua" })
  })

  it("la misma factura repetida no es ambigüedad", async () => {
    const d = deps([[f(), f()]])
    expect(await resolverFactura("7040", null, d)).toEqual({ kind: "ok", factura: f() })
  })

  it("sólo dígitos y nada por número → prueba como id", async () => {
    const d = deps([[]], f({ alegraId: "123" }))
    expect(await resolverFactura("123", null, d)).toEqual({ kind: "ok", factura: f({ alegraId: "123" }) })
    expect(d.porId).toHaveBeenCalledWith("123")
  })

  it("con guiones no se prueba como id", async () => {
    const d = deps([[]], f())
    expect(await resolverFactura("00201-00007040", null, d)).toEqual({ kind: "no_encontrada" })
    expect(d.porId).not.toHaveBeenCalled()
  })

  it("vacío → no consulta", async () => {
    const d = deps()
    expect(await resolverFactura("  ", null, d)).toEqual({ kind: "no_encontrada" })
    expect(d.porNumero).not.toHaveBeenCalled()
  })
})
