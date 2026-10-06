import { describe, expect, it, vi } from "vitest";
import { cuerpoCobro, enviarCobro } from "./payway-cobro-cliente";

const PARAMS = { pedidoId: "ped-1", token: "token-de-prueba", bin: "450799", metodoPagoId: 1, cuotas: 3 };

const respuesta = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

describe("cuerpoCobro", () => {
  it("sólo token, bin, ids y cuotas: nunca el monto ni datos de la tarjeta", () => {
    const c = cuerpoCobro(PARAMS);
    expect(c).toEqual({
      pedidoId: "ped-1",
      medio: "tarjeta",
      token: PARAMS.token,
      bin: "450799",
      metodoPagoId: "1",
      cuotas: 3,
    });
    expect(Object.keys(c).sort()).toEqual(["bin", "cuotas", "medio", "metodoPagoId", "pedidoId", "token"]);
  });
});

describe("enviarCobro", () => {
  it("POST /api/pagos/payway con ese cuerpo", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(200, { estado: "pagado" }));
    const r = await enviarCobro(PARAMS, f);
    expect(r).toEqual({ fase: "pagado" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/pagos/payway");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(cuerpoCobro(PARAMS));
  });

  it("pendiente", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(200, { estado: "pendiente" }));
    expect(await enviarCobro(PARAMS, f)).toEqual({ fase: "pendiente" });
  });

  it("rechazo: usa el mensaje traducido del servidor y si conviene reintentar", async () => {
    const f = vi.fn().mockResolvedValue(
      respuesta(200, { estado: "fallido", mensaje: "La tarjeta no tiene fondos suficientes.", reintentable: false }),
    );
    expect(await enviarCobro(PARAMS, f)).toEqual({
      fase: "rechazado",
      mensaje: "La tarjeta no tiene fondos suficientes.",
      reintentable: false,
    });
  });

  it("error HTTP del servidor: muestra su mensaje y permite reintentar", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(502, { error: "No pudimos procesar el pago. Inténtelo de nuevo en un momento." }));
    expect(await enviarCobro(PARAMS, f)).toEqual({
      fase: "rechazado",
      mensaje: "No pudimos procesar el pago. Inténtelo de nuevo en un momento.",
      reintentable: true,
    });
  });

  it("409 pago en curso: no invita a reintentar", async () => {
    const f = vi.fn().mockResolvedValue(respuesta(409, { error: "Ya hay un pago en proceso.", motivo: "pago_en_curso" }));
    expect(await enviarCobro(PARAMS, f)).toMatchObject({ fase: "rechazado", reintentable: false });
  });

  it("falla de red al enviar el token: NO se sabe si se cobró -> pendiente, no reintentar", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await enviarCobro(PARAMS, f)).toEqual({ fase: "pendiente" });
  });
});
