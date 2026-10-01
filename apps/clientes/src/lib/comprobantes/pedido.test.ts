import { describe, expect, it } from "vitest";
import {
  MAX_COMPROBANTES_POR_PEDIDO,
  datosClienteDelPedido,
  montoPrecargado,
  motivoNoInformable,
  puedeSubirComprobante,
  type PedidoParaComprobante,
} from "./pedido";
import { normalizarMonto, parseAmount } from "./validacion";

const pedido = (over: Partial<PedidoParaComprobante> = {}): PedidoParaComprobante => ({
  id: "11111111-2222-4333-8444-555555555555",
  numero: "PED-00000042",
  total: 150000,
  pagoMetodo: "transferencia",
  pagoEstado: "pendiente",
  estado: "pendiente",
  clienteRazonSocial: null,
  facturacionRazonSocial: null,
  contactoNombre: "Carla Compradora",
  clienteCuit: null,
  facturacionNroDoc: null,
  clienteEmail: null,
  ...over,
});

describe("motivoNoInformable", () => {
  it("transferencia con pago pendiente: se puede informar", () => {
    expect(motivoNoInformable(pedido())).toBeNull();
  });

  it("sólo transferencia", () => {
    expect(motivoNoInformable(pedido({ pagoMetodo: "mercadopago" }))).toBe("no_transferencia");
    expect(motivoNoInformable(pedido({ pagoMetodo: "efectivo" }))).toBe("no_transferencia");
  });

  it("sólo con el pago pendiente", () => {
    expect(motivoNoInformable(pedido({ pagoEstado: "pagado" }))).toBe("pagado");
  });

  it("un pedido cancelado no se informa", () => {
    expect(motivoNoInformable(pedido({ estado: "cancelado" }))).toBe("cancelado");
  });
});

describe("datosClienteDelPedido (snapshot del comprador sin cuenta corriente)", () => {
  it("razón social: la del cliente, si no la de facturación, si no el contacto", () => {
    expect(datosClienteDelPedido(pedido({ clienteRazonSocial: "Cliente SA" })).razonsocial).toBe("Cliente SA");
    expect(datosClienteDelPedido(pedido({ facturacionRazonSocial: "Factura SRL" })).razonsocial).toBe("Factura SRL");
    expect(datosClienteDelPedido(pedido()).razonsocial).toBe("Carla Compradora");
  });

  it("CUIT: el del cliente, si no el documento de facturación, si no vacío; email nulo si falta", () => {
    expect(datosClienteDelPedido(pedido({ clienteCuit: "30123456780" })).cuit).toBe("30123456780");
    expect(datosClienteDelPedido(pedido({ facturacionNroDoc: "20111111112" })).cuit).toBe("20111111112");
    expect(datosClienteDelPedido(pedido())).toMatchObject({ cuit: "", email: null });
    expect(datosClienteDelPedido(pedido({ clienteEmail: " a@cliente.example " })).email).toBe("a@cliente.example");
  });
});

describe("tope por pedido", () => {
  it("son 5 comprobantes por pedido", () => {
    expect(MAX_COMPROBANTES_POR_PEDIDO).toBe(5);
  });
});

describe("montoPrecargado (el total del pedido en el formulario)", () => {
  it("con dos decimales y coma, sin separador de miles", () => {
    expect(montoPrecargado(150000)).toBe("150000,00");
    expect(montoPrecargado(1210.5)).toBe("1210,50");
    expect(montoPrecargado(0.1 + 0.2)).toBe("0,30");
  });

  it("es un monto que el formulario acepta tal cual", () => {
    expect(parseAmount(normalizarMonto(montoPrecargado(150000.5)))).toBe("150000.50");
    expect(parseAmount(normalizarMonto(montoPrecargado(999.99)))).toBe("999.99");
  });
});

describe("puedeSubirComprobante (botón en el detalle del pedido de Mi cuenta)", () => {
  const vista = (over: Record<string, string> = {}) => ({
    pagoMetodoSlug: "transferencia",
    pagoEstado: "pendiente",
    estado: "pendiente",
    ...over,
  });

  it("transferencia pendiente sin cancelar: sí", () => {
    expect(puedeSubirComprobante(vista())).toBe(true);
    expect(puedeSubirComprobante(vista({ estado: "confirmado" }))).toBe(true);
  });

  it("otro medio, pagado, cancelado o sin medio: no", () => {
    expect(puedeSubirComprobante(vista({ pagoMetodoSlug: "mercadopago" }))).toBe(false);
    expect(puedeSubirComprobante(vista({ pagoEstado: "pagado" }))).toBe(false);
    expect(puedeSubirComprobante(vista({ estado: "cancelado" }))).toBe(false);
    expect(puedeSubirComprobante({ pagoEstado: "pendiente", estado: "pendiente" })).toBe(false);
  });
});
