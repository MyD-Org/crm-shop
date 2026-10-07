import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto } from "@/lib/pedidos";

/**
 * Cancelar un pedido con un pago en curso dejaba la puerta abierta a un pedido
 * cancelado y cobrado: si el pago se aprobaba después, la plata entraba igual.
 */

const cancelarPedidoPendiente = vi.fn();
const intentoAbiertoDelPedido = vi.fn();
const resolverIntentoAbierto = vi.fn();

const identidadActual = vi.fn();
vi.mock("@/lib/auth", () => ({
  identidadActual: () => identidadActual(),
}));
vi.mock("@/lib/cache-invalidar", () => ({ marcarStockCambiado: () => {} }));
vi.mock("@/lib/pedidos", () => ({
  cancelarPedidoPendiente: (...a: unknown[]) => cancelarPedidoPendiente(...a),
  intentoAbiertoDelPedido: (...a: unknown[]) => intentoAbiertoDelPedido(...a),
  lineasDelPedidoParaCarrito: async () => LINEAS,
}));
const LINEAS = [{ id: "12", name: "Lámpara", brand: "Marca", price: 1210, qty: 2 }];
vi.mock("@/lib/pagos", () => ({
  proveedorPago: (id: string) => (id === "mercadopago" ? { id } : null),
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({
  resolverIntentoAbierto: (...a: unknown[]) => resolverIntentoAbierto(...a),
}));

import { POST } from "./route";

const cancelar = () =>
  POST(new Request("http://localhost/api/pedidos/p1/cancelar", { method: "POST" }), {
    params: Promise.resolve({ id: "p1" }),
  });

const abierto: IntentoAbierto = { id: "i1", proveedor: "mercadopago", referencia: "r1", creadoEn: new Date() };

beforeEach(() => {
  for (const f of [cancelarPedidoPendiente, intentoAbiertoDelPedido, resolverIntentoAbierto]) f.mockReset();
  intentoAbiertoDelPedido.mockResolvedValue(null);
  cancelarPedidoPendiente.mockResolvedValue("cancelado");
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
});

describe("POST /api/pedidos/:id/cancelar", () => {
  it("sin pagos abiertos: cancela", async () => {
    const r = await cancelar();
    expect(await r.json()).toEqual({ ok: true, items: LINEAS });
    expect(resolverIntentoAbierto).not.toHaveBeenCalled();
  });

  it("con un pago que se pudo cancelar en el proveedor: cancela el pedido", async () => {
    intentoAbiertoDelPedido.mockResolvedValue(abierto);
    resolverIntentoAbierto.mockResolvedValue("libre");
    expect((await cancelar()).status).toBe(200);
    expect(cancelarPedidoPendiente).toHaveBeenCalledTimes(1);
  });

  it("con un pago que sigue en curso: 409 y el pedido no se toca", async () => {
    intentoAbiertoDelPedido.mockResolvedValue(abierto);
    resolverIntentoAbierto.mockResolvedValue("en_curso");
    const r = await cancelar();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pago_en_curso" });
    expect(cancelarPedidoPendiente).not.toHaveBeenCalled();
  });

  it("con un pago que resultó aprobado: 409 'pagado', no se cancela", async () => {
    intentoAbiertoDelPedido.mockResolvedValue(abierto);
    resolverIntentoAbierto.mockResolvedValue("pagado");
    const r = await cancelar();
    expect(await r.json()).toMatchObject({ motivo: "pagado" });
    expect(cancelarPedidoPendiente).not.toHaveBeenCalled();
  });

  it("se abrió un intento justo antes de cancelar: 409, no 404", async () => {
    cancelarPedidoPendiente.mockResolvedValue("pago_en_curso");
    const r = await cancelar();
    expect(r.status).toBe(409);
  });

  it("con un pago informado (comprobante): 409 con el aviso y motivo pago_informado", async () => {
    cancelarPedidoPendiente.mockResolvedValue("pago_informado");
    const r = await cancelar();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error:
        "Este pedido ya tiene un pago informado y no se puede cancelar desde la tienda. Si necesita cancelarlo, comuníquese con nosotros.",
      motivo: "pago_informado",
    });
  });

  it("pedido que no califica: el 404 genérico de siempre", async () => {
    cancelarPedidoPendiente.mockResolvedValue(null);
    expect((await cancelar()).status).toBe(404);
  });

  it("sin sesión: 401 y no se toca nada", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await cancelar()).status).toBe(401);
    expect(cancelarPedidoPendiente).not.toHaveBeenCalled();
  });

  it("pasa el dueño a la cancelación (filtro por usuario del lado del servidor)", async () => {
    await cancelar();
    expect(cancelarPedidoPendiente).toHaveBeenCalledWith("p1", { clerkUserId: "user_1", clienteCodigo: undefined });
  });

  describe("para cambiar el medio de pago (?para=cambiar-medio)", () => {
    const cambiar = () =>
      POST(new Request("http://localhost/api/pedidos/p1/cancelar?para=cambiar-medio", { method: "POST" }), {
        params: Promise.resolve({ id: "p1" }),
      });

    it("rechazo o formulario sin enviar: cancela y devuelve las líneas", async () => {
      const r = await cambiar();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, items: LINEAS });
    });

    it("pago en vuelo: 409 en usted, sin tocar el pedido", async () => {
      intentoAbiertoDelPedido.mockResolvedValue(abierto);
      resolverIntentoAbierto.mockResolvedValue("en_curso");
      const r = await cambiar();
      expect(r.status).toBe(409);
      const j = await r.json();
      expect(j.motivo).toBe("pago_en_curso");
      expect(j.error).toContain("antes de cambiar el medio de pago");
      expect(cancelarPedidoPendiente).not.toHaveBeenCalled();
    });

    it("ya pagado: 409 'pagado' con el texto del cambio", async () => {
      intentoAbiertoDelPedido.mockResolvedValue(abierto);
      resolverIntentoAbierto.mockResolvedValue("pagado");
      const r = await cambiar();
      expect(r.status).toBe(409);
      const j = await r.json();
      expect(j.motivo).toBe("pagado");
      expect(j.error).toContain("no se puede cambiar el medio de pago");
    });

    it("pedido ajeno o que no está pendiente: 404 genérico", async () => {
      cancelarPedidoPendiente.mockResolvedValue(null);
      expect((await cambiar()).status).toBe(404);
    });

    it("sin sesión: 401", async () => {
      identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
      expect((await cambiar()).status).toBe(401);
    });
  });
});
