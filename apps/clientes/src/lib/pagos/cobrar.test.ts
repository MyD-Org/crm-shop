import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import type { ProveedorPago } from "./tipos";

/**
 * `cobrarPedido` es genérica: el procesador sale del medio del pedido. Acá se fija lo que MP no
 * puede probar: un pedido de OTRO procesador no se cobra por éste, y el motivo del 409 sin
 * credenciales no menciona a MP.
 */

const registrarCobro = vi.fn();
const getPedidoParaPago = vi.fn();
const crearPago = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: async () => ({ intentoId: "i1" }),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: async () => undefined,
}));
vi.mock("./intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));

import { cobrarPedido } from "./cobrar";

let configurado = true;
const otro: ProveedorPago = {
  id: "otroprocesador",
  configurado: () => configurado,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
};

const pagar = () =>
  cobrarPedido(
    otro,
    new Request("https://tienda.example/api/pagos/otroprocesador", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", cuotas: 1 }),
    }),
  );

const pedido = (pagoMetodo: string): PedidoParaPago => ({
  id: "p1", numero: "PED-1", total: 100, pagoEstado: "pendiente", pagoMetodo,
  clienteEmail: null, facturacionTipoDoc: null, facturacionNroDoc: null,
  cuotas: 1, estado: "pendiente", creadoEn: new Date(),
});

beforeEach(() => {
  configurado = true;
  for (const f of [registrarCobro, getPedidoParaPago, crearPago]) f.mockReset();
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
});

describe("cobrarPedido — procesador genérico", () => {
  it("un pedido cuyo medio lo cobra OTRO procesador no se cobra por éste (mismo 404 que uno ajeno)", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago")); // procesadorDeMedio = mercadopago ≠ otroprocesador
    const r = await pagar();
    expect(r.status).toBe(404);
    expect(crearPago).not.toHaveBeenCalled();
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("sin credenciales → 409 con motivo genérico (no mp_no_configurado)", async () => {
    configurado = false;
    const r = await pagar();
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("procesador_no_configurado");
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });
});
