import { describe, expect, it, vi } from "vitest";
import { asegurarCuotasDelPedido, cambiarFormaDelPedido, consultarOpcionesCuotas } from "./checkout-cuotas-cliente";

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
    expect(await consultarOpcionesCuotas("p1", { bin: "45071234" }, signal, fetcher)).toBe(datos);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/pedidos/p1/cuotas");
    expect(JSON.parse(init.body)).toEqual({ bin: "45071234" });
    expect(init.signal).toBe(signal);
  });
  it("sin BIN: cuerpo vacío (planes de referencia)", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, {}));
    await consultarOpcionesCuotas("p1", {}, new AbortController().signal, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({});
  });
  it("Payway: la marca elegida o detectada viaja en el cuerpo (sin BIN)", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, {}));
    await consultarOpcionesCuotas("p1", { bin: null, marca: "naranja" }, new AbortController().signal, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ marca: "naranja" });
  });
  it("respuesta no OK o sin opciones: null", async () => {
    expect(await consultarOpcionesCuotas("p1", {}, new AbortController().signal, vi.fn().mockResolvedValue(respuesta(500, {})))).toBeNull();
    expect(await consultarOpcionesCuotas("p1", {}, new AbortController().signal, vi.fn().mockResolvedValue(respuesta(200, { x: 1 })))).toBeNull();
  });
});

describe("asegurarCuotasDelPedido con forma de pago", () => {
  it("pedido con forma congelada y otra forma al cobrar: POST /medio con la forma; devuelve la forma congelada", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, { cuotas: 1, total: 45000, formaCobro: "debito" }));
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 1,
      forma: "debito",
      actual: { cuotas: null, total: 50000, formaCobro: "credito" },
      fetcher,
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ pagoMetodo: "mercadopago", cuotas: 1, forma: "debito" });
    expect(r).toEqual({ ok: true, cambio: true, cuotas: 1, total: 45000, formaCobro: "debito" });
  });

  it("al recongelar cuotas de un pedido con forma, la forma viaja siempre (el servidor no vuelve a la de por defecto)", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, { cuotas: 3, total: 54000, formaCobro: "credito" }));
    await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 3,
      forma: "credito",
      actual: { cuotas: 1, total: 50000, formaCobro: "credito" },
      fetcher,
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).forma).toBe("credito");
  });

  it("pedido sin forma congelada: la forma no viaja ni recotiza", async () => {
    const fetcher = vi.fn();
    const r = await asegurarCuotasDelPedido({
      pedidoId: "p1",
      pagoMetodo: "mercadopago",
      cuotas: 1,
      forma: "debito",
      actual: { cuotas: null, total: 50000, formaCobro: null },
      fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});

describe("cambiarFormaDelPedido", () => {
  it("POST /medio con medio, forma y 1 pago; devuelve total, cuotas y forma que congeló el servidor", async () => {
    const fetcher = vi.fn().mockResolvedValue(respuesta(200, { cuotas: 1, total: 45000, formaCobro: "debito" }));
    const r = await cambiarFormaDelPedido({ pedidoId: "p 1", pagoMetodo: "payway", forma: "debito", fetcher });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/pedidos/p%201/medio");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ pagoMetodo: "payway", forma: "debito", cuotas: 1 });
    expect(r).toEqual({ ok: true, total: 45000, cuotas: 1, formaCobro: "debito" });
  });

  it("409 (cobro en vuelo, pago en revisión) y 429: devuelve el mensaje del servidor", async () => {
    for (const status of [409, 429]) {
      const fetcher = vi.fn().mockResolvedValue(respuesta(status, { error: "Mensaje del servidor." }));
      expect(await cambiarFormaDelPedido({ pedidoId: "p1", pagoMetodo: "mercadopago", forma: "debito", fetcher })).toEqual({
        ok: false,
        error: "Mensaje del servidor.",
      });
    }
  });

  it("respuesta sin total o sin red: error en usted", async () => {
    const sinTotal = vi.fn().mockResolvedValue(respuesta(200, {}));
    const r1 = await cambiarFormaDelPedido({ pedidoId: "p1", pagoMetodo: "mercadopago", forma: "debito", fetcher: sinTotal });
    expect(r1.ok).toBe(false);
    const sinRed = vi.fn().mockRejectedValue(new Error("red"));
    const r2 = await cambiarFormaDelPedido({ pedidoId: "p1", pagoMetodo: "mercadopago", forma: "debito", fetcher: sinRed });
    expect(r2).toEqual({ ok: false, error: "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo." });
  });
});
