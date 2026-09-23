import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";

/**
 * La ruta de cobro sólo chequeaba dueño y "ya pagado": nunca miraba el método
 * del pedido. Con "a_coordinar" eso dejaba cobrar por Mercado Pago un pedido
 * que el comprador confirmó SIN medio de pago, con sólo conocer su id. Acá se
 * fija que un pedido que no es de Mercado Pago no se cobra nunca, y que con los
 * pagos apagados no se cobra ninguno.
 */

const crearPago = vi.fn();
const registrarCobro = vi.fn();
const registrarIntentoFallido = vi.fn();
const getPedidoParaPago = vi.fn();
let pedido: PedidoParaPago | null;
let pagos = true;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: async () => ({ intentoId: "i1" }),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: (...a: unknown[]) => registrarIntentoFallido(...a),
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({
  resolverIntentoAbierto: async () => "en_curso",
}));
vi.mock("@/lib/pagos/mercadopago", () => ({
  mercadoPago: { id: "mercadopago", crearPago: (...a: unknown[]) => crearPago(...a) },
  urlNotificacion: () => undefined,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => pagos }));

import { POST } from "./route";

const pagar = () =>
  POST(
    new Request("http://localhost/api/pagos/mercadopago", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", medio: "tarjeta", token: "tok", cuotas: 1 }),
    }),
  );

const nadaSeCobro = () => {
  expect(crearPago).not.toHaveBeenCalled();
  expect(registrarCobro).not.toHaveBeenCalled();
  // Tampoco se deja rastro de "intento fallido": eso escribe pago_detalle, y un
  // pedido a coordinar tiene que quedar con sus columnas de pago intactas.
  expect(registrarIntentoFallido).not.toHaveBeenCalled();
};

beforeEach(() => {
  pagos = true;
  pedido = {
    id: "p1", numero: "PED-1", total: 120000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
    clienteEmail: "ana@cliente.example", facturacionTipoDoc: null, facturacionNroDoc: null,
    cuotasMax: null, estado: "pendiente", creadoEn: new Date(),
  };
  getPedidoParaPago.mockReset();
  getPedidoParaPago.mockImplementation(async () => pedido);
  crearPago.mockReset();
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "accredited" });
  registrarCobro.mockReset();
  registrarIntentoFallido.mockReset();
});

describe("POST /api/pagos/mercadopago — método del pedido", () => {
  it("pagos prendidos + pedido de Mercado Pago → se cobra como siempre", async () => {
    const r = await pagar();
    expect(r.status).toBe(200);
    expect(crearPago).toHaveBeenCalledTimes(1);
    expect(registrarCobro).toHaveBeenCalledTimes(1);
  });

  it.each(["a_coordinar", "transferencia", "efectivo", "cuenta_corriente"])(
    "pedido con método %s → el mismo 404 que un pedido ajeno, sin tocar Mercado Pago",
    async (pagoMetodo) => {
      pedido = { ...pedido!, pagoMetodo };
      const r = await pagar();
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "No encontramos ese pedido." });
      nadaSeCobro();
    },
  );

  it("un a_coordinar ya marcado como pagado tampoco contesta 'pagado'", async () => {
    // El chequeo del método va ANTES del atajo de "ya estaba pago": la ruta no
    // confirma nada sobre un pedido que no es suyo para cobrar.
    pedido = { ...pedido!, pagoMetodo: "a_coordinar", pagoEstado: "pagado" };
    const r = await pagar();
    expect(r.status).toBe(404);
    nadaSeCobro();
  });
});

describe("POST /api/pagos/mercadopago — pagos apagados", () => {
  beforeEach(() => {
    pagos = false;
  });

  it("no cobra ni un pedido de Mercado Pago creado cuando estaban prendidos", async () => {
    const r = await pagar();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted.",
      motivo: "pagos_deshabilitados",
    });
    nadaSeCobro();
    // Se corta antes de leer el pedido.
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });

  it("tampoco un a_coordinar", async () => {
    pedido = { ...pedido!, pagoMetodo: "a_coordinar" };
    const r = await pagar();
    expect(r.status).toBe(409);
    nadaSeCobro();
  });
});
