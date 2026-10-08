import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estado del pago de un pedido para su comprador: si hay un intento abierto con referencia, se le
 * pregunta al procesador (sólo consulta, nunca cancela) y se registra por `registrarCobro`, que es
 * quien dispara los avisos. Nada sensible sale en la respuesta.
 */

const getPedidoParaPago = vi.fn();
const intentoAbiertoDelPedido = vi.fn();
const conciliarIntento = vi.fn();
const proveedor = { id: "payway", configurado: () => true, cancelarPago: vi.fn() };
const proveedorPago = vi.fn();
const registrarCobro = vi.fn(async () => true);

vi.mock("@/lib/pedidos", () => ({
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  intentoAbiertoDelPedido: (...a: unknown[]) => intentoAbiertoDelPedido(...a),
  motivoNoCobrable: (p: { estado: string }) => (p.estado === "cancelado" ? "cancelado" : null),
  registrarCobro: (...a: unknown[]) => registrarCobro(...(a as [])),
}));
vi.mock("@/lib/pagos", async () => {
  const tipos = await import("./tipos");
  return { ...tipos, proveedorPago: (...a: unknown[]) => proveedorPago(...a) };
});
vi.mock("./conciliar-intento", () => ({
  conciliarIntento: (...a: unknown[]) => conciliarIntento(...a),
}));

import { estadoPagoDelPedido } from "./estado-pago-pedido";

const dueno = { clerkUserId: "user_1" };
const pedido = (pagoEstado: string, extra: Record<string, unknown> = {}) => ({
  id: "p1",
  pagoEstado,
  pagoMetodo: "payway",
  estado: "pendiente",
  creadoEn: new Date(),
  ...extra,
});
const abierto = { id: "i1", proveedor: "payway", referencia: "ref1", creadoEn: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  proveedorPago.mockReturnValue(proveedor);
  intentoAbiertoDelPedido.mockResolvedValue(abierto);
  conciliarIntento.mockResolvedValue({ estado: { estado: "pendiente" }, cambio: false });
});

describe("estadoPagoDelPedido", () => {
  it("pedido ajeno o inexistente: null", async () => {
    getPedidoParaPago.mockResolvedValue(null);
    expect(await estadoPagoDelPedido("x", dueno)).toBeNull();
    expect(conciliarIntento).not.toHaveBeenCalled();
  });

  it("medio que no es de cobro en línea: devuelve el estado sin consultar a nadie", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente", { pagoMetodo: "transferencia" }));
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pendiente", enLinea: false });
    expect(intentoAbiertoDelPedido).not.toHaveBeenCalled();
  });

  it("ya pagado: no consulta al procesador", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pagado"));
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pagado", enLinea: true });
    expect(conciliarIntento).not.toHaveBeenCalled();
  });

  it("pendiente con intento abierto: consulta (sin cancelar) y devuelve el estado resuelto", async () => {
    getPedidoParaPago
      .mockResolvedValueOnce(pedido("pendiente"))
      .mockResolvedValueOnce(pedido("pagado"));
    conciliarIntento.mockResolvedValue({ estado: { estado: "pagado" }, cambio: true });
    const r = await estadoPagoDelPedido("p1", dueno);
    expect(conciliarIntento).toHaveBeenCalledWith(proveedor, {
      orderId: "p1",
      referencia: "ref1",
      creadoEn: abierto.creadoEn,
    });
    expect(proveedor.cancelarPago).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "pagado" });
  });

  it("rechazo: devuelve el mensaje traducido, nunca el detalle crudo", async () => {
    getPedidoParaPago
      .mockResolvedValueOnce(pedido("pendiente"))
      .mockResolvedValueOnce(pedido("fallido"));
    conciliarIntento.mockResolvedValue({
      estado: { estado: "fallido", motivo: "fondos", detalle: "insufficient_amount_SECRETO" },
      cambio: true,
    });
    const r = await estadoPagoDelPedido("p1", dueno);
    expect(r).toMatchObject({ estado: "fallido", cobrable: true });
    expect(r?.mensaje).toMatch(/fondos/);
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });

  it("sigue pendiente en el procesador: pendiente", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente"));
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pendiente" });
  });

  it("reserva sin referencia: no hay nada que consultar, sigue pendiente", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente"));
    intentoAbiertoDelPedido.mockResolvedValue({ ...abierto, referencia: null });
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pendiente" });
    expect(conciliarIntento).not.toHaveBeenCalled();
  });

  it("procesador sin credenciales: no consulta", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente"));
    proveedorPago.mockReturnValue({ ...proveedor, configurado: () => false });
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pendiente" });
    expect(conciliarIntento).not.toHaveBeenCalled();
  });

  it("si la consulta al procesador falla, no rompe: sigue pendiente", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente"));
    conciliarIntento.mockRejectedValue(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pendiente" });
  });

  it("fallido y pedido cancelado: no es cobrable (no se ofrece reintentar)", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("fallido", { estado: "cancelado" }));
    intentoAbiertoDelPedido.mockResolvedValue(null);
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "fallido", cobrable: false });
  });
});

describe("estadoPagoDelPedido: sin cobro en curso y vuelta de Mercado Pago", () => {
  it("pendiente sin ningún intento abierto: sinCobro (el envío nunca llegó al procesador)", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente"));
    intentoAbiertoDelPedido.mockResolvedValue(null);
    expect(await estadoPagoDelPedido("p1", dueno)).toMatchObject({ estado: "pendiente", sinCobro: true });
  });

  it("con un intento abierto no es sinCobro", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("pendiente"));
    expect((await estadoPagoDelPedido("p1", dueno))?.sinCobro).toBeUndefined();
  });

  it("con el payment_id de la vuelta: consulta ese pago y, si es de este pedido, lo registra", async () => {
    const mp = {
      id: "mercadopago",
      configurado: () => true,
      consultarPago: vi.fn(async () => ({ estado: "pagado", detalle: "accredited", pedidoId: "p1" })),
    };
    proveedorPago.mockImplementation((id: string) => (id === "mercadopago" ? mp : proveedor));
    getPedidoParaPago
      .mockResolvedValueOnce(pedido("pendiente", { pagoMetodo: "mercadopago" }))
      .mockResolvedValue(pedido("pagado", { pagoMetodo: "mercadopago" }));
    const r = await estadoPagoDelPedido("p1", dueno, { pagoMercadoPagoId: "123" });
    expect(mp.consultarPago).toHaveBeenCalledWith("123");
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ proveedor: "mercadopago", referencia: "123", estado: "pagado" }));
    expect(r).toMatchObject({ estado: "pagado" });
  });

  it("un payment_id de OTRO pedido no se registra", async () => {
    const mp = {
      id: "mercadopago",
      configurado: () => true,
      consultarPago: vi.fn(async () => ({ estado: "pagado", detalle: "accredited", pedidoId: "otro" })),
    };
    proveedorPago.mockImplementation((id: string) => (id === "mercadopago" ? mp : proveedor));
    getPedidoParaPago.mockResolvedValue(pedido("pendiente", { pagoMetodo: "mercadopago" }));
    await estadoPagoDelPedido("p1", dueno, { pagoMercadoPagoId: "999" });
    expect(registrarCobro).not.toHaveBeenCalled();
  });
});
