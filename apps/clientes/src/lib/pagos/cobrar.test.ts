import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import { ErrorProveedor, type ProveedorPago } from "./tipos";

/**
 * `cobrarPedido` es genérica: el procesador sale del medio del pedido. Acá se fija lo que MP no
 * puede probar: un pedido de OTRO procesador no se cobra por éste, y el motivo del 409 sin
 * credenciales no menciona a MP.
 */

const registrarCobro = vi.fn();
const getPedidoParaPago = vi.fn();
const crearPago = vi.fn();
const fijarReferenciaIntento = vi.fn();
const cerrarIntentoSinPago = vi.fn();
const registrarIntentoFallido = vi.fn();
const orden: string[] = [];

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: async () => ({ intentoId: "i1" }),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: (...a: unknown[]) => registrarIntentoFallido(...a),
  fijarReferenciaIntento: (...a: unknown[]) => fijarReferenciaIntento(...a),
  cerrarIntentoSinPago: (...a: unknown[]) => cerrarIntentoSinPago(...a),
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
  for (const f of [registrarCobro, getPedidoParaPago, crearPago, fijarReferenciaIntento, cerrarIntentoSinPago, registrarIntentoFallido]) f.mockReset();
  orden.length = 0;
  for (const f of [fijarReferenciaIntento, cerrarIntentoSinPago, registrarIntentoFallido]) f.mockResolvedValue(undefined);
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
  vi.spyOn(console, "error").mockImplementation(() => {});
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

/** Un procesador que conoce la referencia ANTES de cobrar y exige el BIN (Payway). */
const conReferencia = (): ProveedorPago & { requiereBin: boolean } => ({
  ...otro,
  id: "payway",
  requiereBin: true,
  referenciaDeIntento: (id: string) => `ref-${id}`,
});

const sinReferencia: ProveedorPago = { ...otro, id: "payway" };

const pagarCon = (p: ProveedorPago, body: Record<string, unknown> = {}) =>
  cobrarPedido(
    p,
    new Request("https://tienda.example/api/pagos/otroprocesador", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", cuotas: 1, bin: "450799", ...body }),
    }),
  );

describe("cobrarPedido — referencia del intento antes de cobrar", () => {
  beforeEach(() => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
  });

  it("graba la referencia en el intento ANTES de llamar al procesador y le pasa intentoId y bin", async () => {
    fijarReferenciaIntento.mockImplementation(async () => void orden.push("fijar"));
    crearPago.mockImplementation(async () => {
      orden.push("crear");
      return { estado: "pagado", referencia: "ref-i1", detalle: "ok" };
    });
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(200);
    expect(orden).toEqual(["fijar", "crear"]);
    expect(fijarReferenciaIntento).toHaveBeenCalledWith("i1", "ref-i1");
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ intentoId: "i1", bin: "450799" }));
  });

  it("timeout o 5xx del procesador: el intento queda abierto CON referencia (no se descarta) para consultarlo", async () => {
    crearPago.mockRejectedValue(new ErrorProveedor("Payway respondió 503", 503));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(502);
    expect(fijarReferenciaIntento).toHaveBeenCalledTimes(1);
    expect(cerrarIntentoSinPago).not.toHaveBeenCalled();
    expect(registrarIntentoFallido).toHaveBeenCalledWith("p1", expect.any(String), undefined);
  });

  it("rechazo del request (4xx): seguro que no hay pago, el intento se cierra aunque ya tenga referencia", async () => {
    crearPago.mockRejectedValue(new ErrorProveedor("Payway respondió 400", 400));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(502);
    expect(cerrarIntentoSinPago).toHaveBeenCalledWith("i1", expect.any(String));
  });

  it("si no se puede grabar la referencia NO se cobra (sin ella un timeout podría duplicar el cobro)", async () => {
    fijarReferenciaIntento.mockRejectedValue(new Error("db caída"));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(502);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("un procesador sin referenciaDeIntento (Mercado Pago) no toca la referencia del intento", async () => {
    await pagarCon(sinReferencia);
    expect(fijarReferenciaIntento).not.toHaveBeenCalled();
    expect(crearPago).toHaveBeenCalledWith(expect.not.objectContaining({ bin: expect.anything() }));
  });
});

describe("cobrarPedido — bin", () => {
  beforeEach(() => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
  });

  it.each([[undefined], [""], ["12345"], ["1234567"], ["45079a"], [450799]])(
    "si el procesador lo requiere, un bin inválido (%j) corta con 400 antes de reservar o cobrar",
    async (bin) => {
      const r = await pagarCon(conReferencia(), { bin });
      expect(r.status).toBe(400);
      expect(crearPago).not.toHaveBeenCalled();
      expect(fijarReferenciaIntento).not.toHaveBeenCalled();
    },
  );

  it("si el procesador no lo requiere, el bin del body se ignora", async () => {
    await pagarCon(sinReferencia, { bin: "no-importa" });
    expect(crearPago).toHaveBeenCalledWith(expect.not.objectContaining({ bin: expect.anything() }));
  });
});
