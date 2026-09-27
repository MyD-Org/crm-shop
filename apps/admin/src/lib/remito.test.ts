import { describe, expect, it, vi } from "vitest"
import type { AlegraRemisionResumen } from "./alegra"
import type { PedidoItemRow } from "./pedidos-repo"
import {
  armarPreviewRemito,
  lineasParaAlegra,
  observacionesRemito,
  parsearUrlAlegraRemito,
  puedeEmitirRemito,
  resolverRemito,
  validarRemision,
} from "./remito"

// Lógica pura de "Emitir remito" / "Vincular remito existente" (rebanada D). Datos inventados.

const r = (over: Partial<AlegraRemisionResumen> = {}): AlegraRemisionResumen => ({
  alegraId: "512",
  numero: "0001-00000512",
  fecha: "2026-05-20",
  clienteAlegraId: "55",
  clienteNombre: "Cliente Ejemplo SA",
  ...over,
})

const item = (over: Partial<PedidoItemRow> = {}): PedidoItemRow =>
  ({
    id: "i1",
    orderId: "o1",
    alegraItemId: "art-1",
    code: "COD-1",
    name: "Producto Uno",
    brand: null,
    qty: "3",
    precioUnitario: "100",
    ivaPorcentaje: "21",
    subtotal: "300",
    iva: "63",
    total: "363",
    ...over,
  }) as PedidoItemRow

describe("parsearUrlAlegraRemito", () => {
  it("reconoce el enlace de un remito", () => {
    expect(parsearUrlAlegraRemito("https://app.alegra.com/remission/view/id/512")).toEqual({
      tipo: "remission",
      id: "512",
    })
  })

  it("reconoce un enlace a otro documento (factura) y lo rechaza aparte", () => {
    expect(parsearUrlAlegraRemito("https://app.alegra.com/invoice/view/id/7040")).toEqual({
      tipo: "otro",
      documento: "invoice",
    })
  })

  it("no matchea un número plano", () => {
    expect(parsearUrlAlegraRemito("0001-00000512")).toBeNull()
  })
})

describe("validarRemision", () => {
  it("cliente verificado cuando coincide con el del pedido", () => {
    expect(validarRemision(r(), "55")).toEqual({ ok: true, clienteVerificado: true })
  })

  it("sin cliente en el pedido, se puede igual, sin verificar", () => {
    expect(validarRemision(r(), null)).toEqual({ ok: true, clienteVerificado: false })
  })

  it("cliente distinto del pedido, se puede igual, sin verificar", () => {
    expect(validarRemision(r({ clienteAlegraId: "99" }), "55")).toEqual({ ok: true, clienteVerificado: false })
  })
})

describe("resolverRemito", () => {
  it("resuelve directo por id con un enlace de Alegra", async () => {
    const porId = vi.fn(async () => r())
    const porNumero = vi.fn(async () => [])
    const resultado = await resolverRemito("https://app.alegra.com/remission/view/id/512", null, { porId, porNumero })
    expect(resultado).toEqual({ kind: "ok", remision: r() })
    expect(porNumero).not.toHaveBeenCalled()
  })

  it("rechaza un enlace a otro tipo de documento sin gastar requests", async () => {
    const porId = vi.fn()
    const porNumero = vi.fn()
    const resultado = await resolverRemito("https://app.alegra.com/invoice/view/id/7040", null, { porId, porNumero })
    expect(resultado).toEqual({ kind: "url_otro_documento", documento: "invoice" })
    expect(porId).not.toHaveBeenCalled()
    expect(porNumero).not.toHaveBeenCalled()
  })

  it("encuentra por número", async () => {
    const porNumero = vi.fn(async () => [r()])
    const porId = vi.fn()
    const resultado = await resolverRemito("0001-00000512", null, { porId, porNumero })
    expect(resultado).toEqual({ kind: "ok", remision: r() })
  })

  it("ambiguo con dos candidatas y sin cliente que desempate", async () => {
    const porNumero = vi.fn(async () => [r(), r({ alegraId: "513", clienteAlegraId: "77" })])
    const porId = vi.fn()
    const resultado = await resolverRemito("512", null, { porId, porNumero })
    expect(resultado).toEqual({ kind: "ambiguo" })
  })

  it("no encontrado cuando no hay candidatas ni id numérico", async () => {
    const porNumero = vi.fn(async () => [])
    const porId = vi.fn()
    const resultado = await resolverRemito("xyz", null, { porId, porNumero })
    expect(resultado).toEqual({ kind: "no_encontrado" })
  })
})

describe("puedeEmitirRemito", () => {
  it("bloquea sin cliente de Alegra", () => {
    expect(puedeEmitirRemito({ clienteCodigo: null }).bloqueo).not.toBeNull()
  })

  it("permite con cliente de Alegra", () => {
    expect(puedeEmitirRemito({ clienteCodigo: "55" }).bloqueo).toBeNull()
  })
})

describe("armarPreviewRemito", () => {
  it("arma una línea por ítem con alegra_item_id", () => {
    const preview = armarPreviewRemito([item()])
    expect(preview.lineas).toEqual([{ alegraItemId: "art-1", nombre: "Producto Uno", cantidad: 3 }])
    expect(preview.avisos).toEqual([])
  })

  it("avisa (sin lanzar) un ítem sin alegra_item_id", () => {
    const preview = armarPreviewRemito([item({ alegraItemId: "" })])
    expect(preview.lineas).toEqual([])
    expect(preview.avisos).toHaveLength(1)
  })
})

describe("lineasParaAlegra", () => {
  it("manda cada línea sin precio (siempre en 0 del lado de createRemission)", () => {
    expect(lineasParaAlegra([{ alegraItemId: "art-1", nombre: "X", cantidad: 2 }])).toEqual([
      { alegraId: "art-1", quantity: 2 },
    ])
  })
})

describe("observacionesRemito", () => {
  it("nombra sólo el pedido sin factura", () => {
    expect(observacionesRemito("PED-00001000", null)).toBe("Pedido PED-00001000")
  })

  it("nombra el pedido y la factura si ya está facturado", () => {
    expect(observacionesRemito("PED-00001000", "00201-00007040")).toBe("Pedido PED-00001000 · Factura 00201-00007040")
  })
})
