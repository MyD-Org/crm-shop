import { describe, expect, it } from "vitest"
import {
  armarCuentaFacturaDto,
  avisoCobroDelPedido,
  nombreVisibleCuenta,
  resolverParaPedido,
  type ContextoCuentaFactura,
} from "./pedido-factura-cuenta-repo"
import { cuentasAlegraRepetidas } from "./sucursales-cuenta"

// Aviso al facturar con una cuenta de Alegra distinta de la que cobró el pago en línea (change
// `cuentas-procesador-por-sucursal`, R3). Datos inventados; la cuenta de cobro es el slug de la
// sucursal y su cuenta de Alegra sale de `sucursales.cuentaAlegraId` (mapeo 1 a 1).

const A_IGZ = "11111111-1111-4111-8111-111111111111"
const A_MDP = "22222222-2222-4222-8222-222222222222"

const cuentaRow = (over: Record<string, unknown>) => ({
  tenantId: "t",
  nombre: "Cuenta",
  cuit: "",
  alegraEmail: "",
  alegraToken: "",
  alegraMock: false,
  principal: false,
  activa: true,
  ...over,
})

const ctx = (over: Partial<ContextoCuentaFactura> = {}): ContextoCuentaFactura =>
  ({
    cuentas: [
      cuentaRow({ id: A_IGZ, slug: "principal", nombre: "Iguazú SA", principal: true }),
      cuentaRow({ id: A_MDP, slug: "mdp", nombre: "Mar del Plata SA" }),
    ],
    sucursales: [
      { slug: "igz", nombre: "Iguazú", cuentaAlegraId: A_IGZ },
      { slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: A_MDP },
    ],
    principalId: A_IGZ,
    fila: null,
    ...over,
  }) as unknown as ContextoCuentaFactura

const pedido = (over: Record<string, unknown> = {}) =>
  ({
    sucursal: "mdp",
    sucursalRegla: null,
    pagoEstado: "pagado",
    pagoProveedor: "mercadopago",
    pagoInfo: { cuentaCobro: "mdp" },
    ...over,
  }) as never

const cuentaMdp = () => ctx().cuentas[1]
const cuentaIgz = () => ctx().cuentas[0]

describe("avisoCobroDelPedido", () => {
  it("la cuenta de Alegra coincide con la de la sucursal que cobró → sin aviso", () => {
    expect(avisoCobroDelPedido(pedido(), ctx(), cuentaMdp())).toBeNull()
  })

  it("se factura con otra cuenta → aviso con quién cobró y con quién se factura", () => {
    expect(avisoCobroDelPedido(pedido(), ctx(), cuentaIgz())).toEqual({
      cobradoCon: { slug: "mdp", nombre: "Mar del Plata" },
      facturaCon: { slug: "principal", nombre: "Iguazú" },
    })
  })

  it("fallback: cobró igz con prevista mdp y se factura por defecto con mdp → aviso contra la que cobró", () => {
    const p = pedido({ pagoInfo: { cuentaCobro: "igz", cuentaCobroPrevista: "mdp" } })
    const aviso = avisoCobroDelPedido(p, ctx(), cuentaMdp())
    expect(aviso?.cobradoCon.slug).toBe("igz")
    expect(aviso?.facturaCon.slug).toBe("mdp")
  })

  it("sin pago en línea (transferencia u otro) → sin aviso", () => {
    expect(avisoCobroDelPedido(pedido({ pagoProveedor: null, pagoInfo: null }), ctx(), cuentaIgz())).toBeNull()
  })

  it("pago que no está aprobado → sin aviso", () => {
    expect(avisoCobroDelPedido(pedido({ pagoEstado: "pendiente" }), ctx(), cuentaIgz())).toBeNull()
  })

  it("pago anterior a la cuenta de cobro (sin cuentaCobro) → sin aviso", () => {
    expect(avisoCobroDelPedido(pedido({ pagoInfo: { tipo: "credito" } }), ctx(), cuentaIgz())).toBeNull()
  })

  it("la sucursal de cobro no tiene cuenta de Alegra o ya no existe → sin aviso ni bloqueo", () => {
    const sinCuenta = ctx({ sucursales: [{ slug: "mdp", nombre: "Mar del Plata", cuentaAlegraId: null }] })
    expect(avisoCobroDelPedido(pedido(), sinCuenta, cuentaIgz())).toBeNull()
    expect(avisoCobroDelPedido(pedido({ pagoInfo: { cuentaCobro: "viejo" } }), ctx(), cuentaIgz())).toBeNull()
  })

  it("sin cuenta que facture → sin aviso (ya hay otro bloqueo)", () => {
    expect(avisoCobroDelPedido(pedido(), ctx(), null)).toBeNull()
  })

  it("tolera un pedido sin los campos de pago (llamadores anteriores)", () => {
    expect(avisoCobroDelPedido({ sucursal: "mdp", sucursalRegla: null } as never, ctx(), cuentaIgz())).toBeNull()
  })
})

describe("armarCuentaFacturaDto: avisoCobro", () => {
  it("por defecto factura con la de la sucursal que cobró → sin aviso", () => {
    expect(armarCuentaFacturaDto(pedido(), ctx(), false).avisoCobro).toBeNull()
  })

  it("el operador elige otra cuenta → aviso", () => {
    const dto = armarCuentaFacturaDto(pedido(), ctx(), false, "principal")
    expect(dto.efectiva?.slug).toBe("principal")
    expect(dto.avisoCobro).toEqual({
      cobradoCon: { slug: "mdp", nombre: "Mar del Plata" },
      facturaCon: { slug: "principal", nombre: "Iguazú" },
    })
  })

  it("el aviso sigue a la cuenta efectiva que usa el servidor", () => {
    const c = ctx()
    const res = resolverParaPedido(pedido(), c, "principal")
    expect(avisoCobroDelPedido(pedido(), c, res.cuenta)).toEqual(armarCuentaFacturaDto(pedido(), c, false, "principal").avisoCobro)
  })
})

describe("cuentasAlegraRepetidas (invariante sucursal ↔ cuenta de Alegra 1 a 1)", () => {
  it("sin repetidas → vacío", () => {
    expect(cuentasAlegraRepetidas(ctx().sucursales)).toEqual([])
  })
  it("dos sucursales activas con la misma cuenta → la reporta", () => {
    const s = [
      { slug: "igz", cuentaAlegraId: A_IGZ },
      { slug: "mdp", cuentaAlegraId: A_IGZ },
    ]
    expect(cuentasAlegraRepetidas(s)).toEqual([{ cuentaAlegraId: A_IGZ, slugs: ["igz", "mdp"] }])
  })
  it("ignora las inactivas y las sin cuenta", () => {
    const s = [
      { slug: "igz", cuentaAlegraId: A_IGZ },
      { slug: "viejo", cuentaAlegraId: A_IGZ, activa: false },
      { slug: "a", cuentaAlegraId: null },
      { slug: "b", cuentaAlegraId: null },
    ]
    expect(cuentasAlegraRepetidas(s)).toEqual([])
  })
})

describe("nombreVisibleCuenta", () => {
  it("muestra el nombre de la sucursal que tiene la cuenta asignada", () => {
    const c = ctx()
    expect(nombreVisibleCuenta(c, c.cuentas[0])).toBe("Iguazú")
    expect(nombreVisibleCuenta(c, c.cuentas[1])).toBe("Mar del Plata")
  })

  it("sin sucursal asignada, cae al nombre de la cuenta", () => {
    const c = ctx({ sucursales: [] })
    expect(nombreVisibleCuenta(c, c.cuentas[0])).toBe("Iguazú SA")
  })
})
