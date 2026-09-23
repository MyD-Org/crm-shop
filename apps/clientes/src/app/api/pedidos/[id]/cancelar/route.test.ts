import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto } from "@/lib/pedidos";

/**
 * Cancelar un pedido con un pago en curso dejaba la puerta abierta a un pedido
 * cancelado y cobrado: si el pago se aprobaba después, la plata entraba igual.
 */

const cancelarPedidoPendiente = vi.fn();
const intentoAbiertoDelPedido = vi.fn();
const resolverIntentoAbierto = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null }),
}));
vi.mock("@/lib/pedidos", () => ({
  cancelarPedidoPendiente: (...a: unknown[]) => cancelarPedidoPendiente(...a),
  intentoAbiertoDelPedido: (...a: unknown[]) => intentoAbiertoDelPedido(...a),
}));
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
});

describe("POST /api/pedidos/:id/cancelar", () => {
  it("sin pagos abiertos: cancela", async () => {
    const r = await cancelar();
    expect(await r.json()).toEqual({ ok: true });
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

  it("pedido que no califica: el 404 genérico de siempre", async () => {
    cancelarPedidoPendiente.mockResolvedValue(null);
    expect((await cancelar()).status).toBe(404);
  });
});
