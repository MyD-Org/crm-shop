import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto, PedidoParaPago } from "@/lib/pedidos";
import { ErrorProveedor } from "@/lib/pagos";

/**
 * Qué pedidos se cobran y cuántos intentos a la vez.
 *
 * Dos agujeros que cierra esta ruta: se podía pagar un pedido cancelado o de
 * hace semanas, y un segundo intento podía abrirse con el primero todavía
 * pendiente en Mercado Pago (los dos se aprobaban: cobro doble).
 */

const crearPago = vi.fn();
const registrarCobro = vi.fn();
const registrarIntentoFallido = vi.fn();
const reservarIntento = vi.fn();
const resolverIntentoAbierto = vi.fn();
let pedido: PedidoParaPago;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  getPedidoParaPago: async () => pedido,
  reservarIntento: (...a: unknown[]) => reservarIntento(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: (...a: unknown[]) => registrarIntentoFallido(...a),
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({
  resolverIntentoAbierto: (...a: unknown[]) => resolverIntentoAbierto(...a),
}));
vi.mock("@/lib/pagos/mercadopago", () => ({
  mercadoPago: { id: "mercadopago", crearPago: (...a: unknown[]) => crearPago(...a) },
  urlNotificacion: () => undefined,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => true }));

import { POST } from "./route";

const pagar = () =>
  POST(
    new Request("http://localhost/api/pagos/mercadopago", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", medio: "tarjeta", token: "tok", cuotas: 1 }),
    }),
  );

const abierto: IntentoAbierto = {
  id: "viejo",
  proveedor: "mercadopago",
  referencia: "r-viejo",
  creadoEn: new Date(),
};

beforeEach(() => {
  pedido = {
    id: "p1", numero: "PED-1", total: 120000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
    clienteEmail: "ana@cliente.example", facturacionTipoDoc: null, facturacionNroDoc: null,
    cuotasMax: null, estado: "pendiente", creadoEn: new Date(),
  };
  for (const f of [crearPago, registrarCobro, registrarIntentoFallido, reservarIntento, resolverIntentoAbierto]) {
    f.mockReset();
  }
  reservarIntento.mockResolvedValue({ intentoId: "nuevo" });
  registrarIntentoFallido.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  crearPago.mockResolvedValue({ estado: "pendiente", referencia: "r-nuevo", detalle: "pending_contingency" });
});

describe("POST /api/pagos/mercadopago — pedidos que no se cobran", () => {
  it.each([
    ["cancelado", { estado: "cancelado" as const }],
    ["tomado por un operador", { estado: "confirmado" as const }],
    ["de hace más de 24 h", { creadoEn: new Date(Date.now() - 25 * 60 * 60_000) }],
  ])("pedido %s → 409 sin abrir intento ni tocar Mercado Pago", async (_, cambio) => {
    pedido = { ...pedido, ...cambio };
    const r = await pagar();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pedido_no_cobrable" });
    expect(reservarIntento).not.toHaveBeenCalled();
    expect(crearPago).not.toHaveBeenCalled();
  });
});

describe("POST /api/pagos/mercadopago — un intento a la vez", () => {
  it("sin intentos abiertos: cobra y ata el resultado a la reserva", async () => {
    const r = await pagar();
    expect(r.status).toBe(200);
    expect(crearPago).toHaveBeenCalledTimes(1);
    expect(registrarCobro).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ referencia: "r-nuevo" }),
      { intentoId: "nuevo" },
    );
  });

  it("con otro intento que no se pudo cerrar → 409 y NO se crea un segundo pago", async () => {
    reservarIntento.mockResolvedValue({ abierto });
    resolverIntentoAbierto.mockResolvedValue("en_curso");
    const r = await pagar();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pago_en_curso" });
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("con otro intento que se canceló → reserva de nuevo y cobra", async () => {
    reservarIntento
      .mockResolvedValueOnce({ abierto })
      .mockResolvedValueOnce({ intentoId: "nuevo" });
    resolverIntentoAbierto.mockResolvedValue("libre");
    const r = await pagar();
    expect(r.status).toBe(200);
    expect(reservarIntento).toHaveBeenCalledTimes(2);
    expect(crearPago).toHaveBeenCalledTimes(1);
  });

  it("con otro intento que resultó aprobado → responde pagado sin cobrar de nuevo", async () => {
    reservarIntento.mockResolvedValue({ abierto });
    resolverIntentoAbierto.mockResolvedValue("pagado");
    const r = await pagar();
    expect(await r.json()).toEqual({ estado: "pagado", yaEstaba: true });
    expect(crearPago).not.toHaveBeenCalled();
  });
});

describe("POST /api/pagos/mercadopago — error al crear el pago", () => {
  it("Mercado Pago rechazó el request (4xx): se cierra la reserva", async () => {
    crearPago.mockRejectedValue(new ErrorProveedor("Mercado Pago respondió 400", 400));
    const r = await pagar();
    expect(r.status).toBe(502);
    expect(registrarIntentoFallido).toHaveBeenCalledWith("p1", expect.any(String), "nuevo");
  });

  it("timeout o 5xx: la reserva queda abierta, el pago pudo haberse creado", async () => {
    crearPago.mockRejectedValue(new Error("The operation was aborted due to timeout"));
    await pagar();
    expect(registrarIntentoFallido).toHaveBeenCalledWith("p1", expect.any(String), undefined);

    crearPago.mockRejectedValue(new ErrorProveedor("Mercado Pago respondió 503", 503));
    await pagar();
    expect(registrarIntentoFallido).toHaveBeenLastCalledWith("p1", expect.any(String), undefined);
  });
});
