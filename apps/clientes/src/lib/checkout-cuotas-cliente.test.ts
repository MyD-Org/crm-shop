import { describe, expect, it, vi } from "vitest";
import { asegurarCuotasDelPedido, consultarOpcionesCuotas } from "./checkout-cuotas-cliente";

const respuesta = (status: number, json: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => json }) as Response;

describe("asegurarCuotasDelPedido", () => {
  it("si el pedido ya está en esas cuotas no llama al servidor", async () => {
    const fetcher = vi.fn();
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 1,
      totalVisto: 50000,
      actual: { cuotas: null, total: 50000 },
      fetcher,
    });
    expect(r).toEqual({ ok: true, cambio: false, cuotas: null, total: 50000 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("UN POST /medio con el medio, las cuotas y el total visto; devuelve lo que congeló el servidor", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, { cuotas: 3, total: 54000 }));
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 3,
      totalVisto: 54000,
      actual: { cuotas: 1, total: 50000 },
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/pedidos/p1/medio");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ pagoMetodo: "mercadopago", cuotas: 3, totalVisto: 54000 });
    expect(r).toEqual({ ok: true, cambio: true, cuotas: 3, total: 54000 });
  });

  it("débito o cuenta con el pedido en cuotas: primero vuelve a 1 pago", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, { cuotas: 1, total: 50000 }));
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 1,
      totalVisto: 50000,
      actual: { cuotas: 6, total: 60000 },
      fetcher,
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).cuotas).toBe(1);
    expect(r.ok).toBe(true);
  });

  it("409/422: devuelve el mensaje del servidor para mostrarlo y re-sincronizar", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(409, { error: "El precio cambió.", motivo: "precio_cambio" }));
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 3,
      totalVisto: 54000,
      actual: { cuotas: 1, total: 50000 },
      fetcher,
    });
    expect(r).toEqual({ ok: false, error: "El precio cambió." });
  });

  it("sin conexión: mensaje en usted", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 3,
      totalVisto: 54000,
      actual: { cuotas: 1, total: 50000 },
      fetcher,
    });
    expect(r).toEqual({ ok: false, error: "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo." });
  });
});

describe("consultarOpcionesCuotas", () => {
  it("POST con el BIN en el cuerpo (no en la URL)", async () => {
    const datos = { opciones: [] };
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, datos));
    const signal = new AbortController().signal;
    expect(await consultarOpcionesCuotas("p1", "45071234", signal, fetcher)).toBe(datos);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/pedidos/p1/cuotas");
    expect(JSON.parse(init.body)).toEqual({ bin: "45071234" });
    expect(init.signal).toBe(signal);
  });
  it("sin BIN: cuerpo vacío (planes de referencia)", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, {}));
    await consultarOpcionesCuotas("p1", null, new AbortController().signal, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({});
  });
  it("respuesta no OK o sin opciones: null", async () => {
    expect(await consultarOpcionesCuotas("p1", null, new AbortController().signal, vi.fn().mockResolvedValue(respuesta(500, {})))).toBeNull();
    expect(await consultarOpcionesCuotas("p1", null, new AbortController().signal, vi.fn().mockResolvedValue(respuesta(200, { x: 1 })))).toBeNull();
  });
});
