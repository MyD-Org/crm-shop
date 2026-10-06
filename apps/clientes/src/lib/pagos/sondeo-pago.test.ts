import { describe, expect, it, vi } from "vitest";
import { VENTANA_SONDEO_MS, consultarPagoDelPedido, esperaSondeo } from "./sondeo-pago";

const respuesta = (status: number, cuerpo: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(cuerpo), { status }));
const consulta = (r: Promise<Response> | (() => Promise<Response>)) =>
  consultarPagoDelPedido("p 1", vi.fn(typeof r === "function" ? r : () => r) as unknown as typeof fetch);

describe("esperaSondeo", () => {
  it("cada 5 s al principio y espaciando después", () => {
    expect([0, 5].map(esperaSondeo)).toEqual([5_000, 5_000]);
    expect([6, 11].map(esperaSondeo)).toEqual([10_000, 10_000]);
    expect([12, 40].map(esperaSondeo)).toEqual([15_000, 15_000]);
  });

  it("la ventana es de unos 3 minutos y alcanzan varias consultas", () => {
    expect(VENTANA_SONDEO_MS).toBe(180_000);
    let t = 0;
    let n = 0;
    while (t + esperaSondeo(n) <= VENTANA_SONDEO_MS) t += esperaSondeo(n++);
    expect(n).toBeGreaterThanOrEqual(12);
    expect(n).toBeLessThanOrEqual(20);
  });
});

describe("consultarPagoDelPedido", () => {
  it("pega al endpoint del pedido, escapando el id y sin cache", async () => {
    const f = vi.fn(() => respuesta(200, { estado: "pendiente" }));
    await consultarPagoDelPedido("p 1", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("/api/pedidos/p%201/pago", { cache: "no-store" });
  });

  it("pagado", async () => {
    expect(await consulta(respuesta(200, { estado: "pagado" }))).toEqual({ fase: "pagado" });
  });

  it("pendiente, también ante un error del servidor o un 429", async () => {
    expect(await consulta(respuesta(200, { estado: "pendiente" }))).toEqual({ fase: "pendiente" });
    expect(await consulta(respuesta(500))).toEqual({ fase: "pendiente" });
    expect(await consulta(respuesta(429))).toEqual({ fase: "pendiente" });
  });

  it("sin conexión sigue esperando", async () => {
    expect(await consulta(() => Promise.reject(new Error("red")))).toEqual({ fase: "pendiente" });
  });

  it("rechazado: trae el mensaje del servidor y que se puede reintentar", async () => {
    expect(
      await consulta(respuesta(200, { estado: "fallido", mensaje: "Su banco rechazó la operación.", cobrable: true })),
    ).toEqual({ fase: "rechazado", mensaje: "Su banco rechazó la operación.", cobrable: true });
  });

  it("rechazado de un pedido que ya no se puede pagar: lo dice", async () => {
    const r = await consulta(respuesta(200, { estado: "fallido", mensaje: "Su banco rechazó.", cobrable: false }));
    expect(r).toMatchObject({ fase: "rechazado", cobrable: false });
    expect(r.fase === "rechazado" && r.mensaje).toMatch(/genere un pedido nuevo/);
  });

  it("sin sesión o pedido inexistente: no hay nada que seguir consultando", async () => {
    expect(await consulta(respuesta(401))).toEqual({ fase: "perdido" });
    expect(await consulta(respuesta(404))).toEqual({ fase: "perdido" });
  });
});
