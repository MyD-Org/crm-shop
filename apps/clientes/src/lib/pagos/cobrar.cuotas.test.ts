import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import type { ProveedorPago } from "./tipos";
import type { ResultadoPlanesMP } from "./mercadopago-planes";

/**
 * Cuotas en `cobrarPedido` (change cuotas-en-el-formulario, rebanada 3): marca permitida, cuotas con
 * interés de Mercado Pago contra los planes del BIN (consultados en el servidor) y la intención que
 * queda en el intento. Todo rechazo corta ANTES de reservar el intento y de llamar al procesador.
 */

const reservarIntento = vi.fn(async (..._a: unknown[]) => ({ intentoId: "i1" }) as unknown);
const getPedidoParaPago = vi.fn();
const crearPago = vi.fn();
const consultarPlanesMP = vi.fn(async (..._a: unknown[]): Promise<ResultadoPlanesMP> => ({ ok: false }));

const medios = vi.hoisted(() => ({
  lista: [] as { slug: string; opcionesCobro?: string[]; condicionesCuotas?: unknown[] }[],
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios.lista }));
vi.mock("./mercadopago-planes", () => ({ consultarPlanesMP: (...a: unknown[]) => consultarPlanesMP(...a) }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  cuentasRechazadasDelPedido: async () => [],
  detalleCredencialesRechazadas: (c: string) => `credenciales_rechazadas:${c}`,
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: (...a: unknown[]) => reservarIntento(...a),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  getItemsParaAntifraude: vi.fn(),
  registrarCobro: vi.fn(),
  registrarIntentoFallido: vi.fn(async () => {}),
  fijarReferenciaIntento: vi.fn(),
  cerrarIntentoSinPago: vi.fn(),
}));
vi.mock("./intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));

// El proveedor ligado a la cuenta del pedido es el doble `mp` (la cuenta se prueba en cobrar.cuenta.test.ts).
const doble = vi.hoisted(() => ({ mp: null as null | import("./tipos").ProveedorPago }));
vi.mock("@/lib/pagos", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos")>()),
  proveedorPago: (id: string, cuenta: string) => (id === "mercadopago" && doble.mp ? { ...doble.mp, cuenta } : null),
}));
vi.mock("./credenciales", async (orig) => ({
  ...(await orig<typeof import("./credenciales")>()),
  hayCuentaConfigurada: () => true,
}));
vi.mock("./cuentas-sucursales", () => ({
  cuentaParaCobrar: async () => ({ ok: true, cuenta: "mdp", prevista: "mdp", fallback: false }),
  proveedorDeIntento: async () => null,
}));

import { cobrarPedido } from "./cobrar";

const mp: ProveedorPago = {
  id: "mercadopago",
  cuenta: "mdp",
  configurado: () => true,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
};

const pedido = (cuotas: number | null): PedidoParaPago => ({
  id: "p1", numero: "PED-1", total: 50000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
  clienteEmail: null, facturacionTipoDoc: null, facturacionNroDoc: null,
  cuotas, estado: "pendiente", creadoEn: new Date(),
});

doble.mp = mp;

const pagar = (body: Record<string, unknown>) =>
  cobrarPedido(
    "mercadopago",
    new Request("https://tienda.example/api/pagos/mercadopago", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", metodoPagoId: "visa", ...body }),
    }),
  );

const planes = (...cuotas: number[]): ResultadoPlanesMP => ({
  ok: true,
  entrada: {
    metodoPagoId: "visa",
    emisor: null,
    logo: null,
    planes: cuotas.map((n) => ({ cuotas: n, montoCuota: 1, total: 1, tasaPct: 10, cft: "1,00", tea: "1,00", conInteres: true })),
  },
});

const sinEfectos = () => {
  expect(reservarIntento).not.toHaveBeenCalled();
  expect(crearPago).not.toHaveBeenCalled();
};

beforeEach(() => {
  for (const f of [reservarIntento, getPedidoParaPago, crearPago, consultarPlanesMP]) f.mockClear();
  reservarIntento.mockImplementation(async () => ({ intentoId: "i1" }));
  consultarPlanesMP.mockImplementation(async () => ({ ok: false }));
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
  medios.lista = [
    {
      slug: "mercadopago",
      condicionesCuotas: [
        { cuotas: 3, idListaPrecios: "l3", marcas: null },
        { cuotas: 6, idListaPrecios: "l6", marcas: ["visa", "mastercard"] },
      ],
    },
  ];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cuotas sin interés congeladas: marca de la tarjeta", () => {
  it("marca fuera de la condición → 422 marca_no_permitida, sin intento ni procesador", async () => {
    getPedidoParaPago.mockResolvedValue(pedido(6));
    const r = await pagar({ cuotas: 6, metodoPagoId: "amex" });
    expect(r.status).toBe(422);
    expect((await r.json()).motivo).toBe("marca_no_permitida");
    sinEfectos();
  });

  it("marca incluida → cobra, sin consultar a MP, intención sin interés", async () => {
    getPedidoParaPago.mockResolvedValue(pedido(6));
    const r = await pagar({ cuotas: 6, metodoPagoId: "master" });
    expect(r.status).toBe(200);
    expect(consultarPlanesMP).not.toHaveBeenCalled();
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", {
      cuotas: 6,
      totalEsperado: 50000,
      conInteres: false,
    }, expect.objectContaining({ cuenta: expect.any(String) }));
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ monto: 50000, cuotas: 6 }));
  });

  it("condición sin restricción: cualquier marca", async () => {
    getPedidoParaPago.mockResolvedValue(pedido(3));
    expect((await pagar({ cuotas: 3, metodoPagoId: "naranja" })).status).toBe(200);
  });
});

describe("cuotas con interés de Mercado Pago (pedido en 1 pago)", () => {
  beforeEach(() => getPedidoParaPago.mockResolvedValue(pedido(1)));

  it("N dentro del plan del BIN → cobra el total del pedido en N cuotas e intención con interés", async () => {
    consultarPlanesMP.mockResolvedValue(planes(3, 6, 12));
    const r = await pagar({ cuotas: 6, bin: "45099512", monto: 1 });
    expect(r.status).toBe(200);
    expect(consultarPlanesMP).toHaveBeenCalledWith(expect.objectContaining({ amount: 50000, bin: "45099512", cuenta: "mdp" }));
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", {
      cuotas: 6,
      totalEsperado: 50000,
      conInteres: true,
    }, expect.objectContaining({ cuenta: expect.any(String) }));
    // El monto del body se ignora: siempre el total del pedido.
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ monto: 50000, cuotas: 6 }));
  });

  it("N fuera del plan → 422 sin intento ni procesador", async () => {
    consultarPlanesMP.mockResolvedValue(planes(3, 6));
    const r = await pagar({ cuotas: 18, bin: "450995" });
    expect(r.status).toBe(422);
    expect((await r.json()).motivo).toBe("cuotas_distintas");
    sinEfectos();
  });

  it("MP no responde → 503 planes_no_disponibles, con mensaje en usted", async () => {
    const r = await pagar({ cuotas: 6, bin: "450995" });
    expect(r.status).toBe(503);
    const json = await r.json();
    expect(json.motivo).toBe("planes_no_disponibles");
    expect(json.error).toMatch(/Elija 1 pago/);
    sinEfectos();
  });

  it("1 pago no consulta a MP y no exige BIN", async () => {
    const r = await pagar({ cuotas: 1 });
    expect(r.status).toBe(200);
    expect(consultarPlanesMP).not.toHaveBeenCalled();
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", {
      cuotas: 1,
      totalEsperado: 50000,
      conInteres: false,
    }, expect.objectContaining({ cuenta: expect.any(String) }));
  });

  it("sin BIN (o inválido) en un cobro de más de 1 cuota → 422 sin consultar a MP", async () => {
    for (const bin of [undefined, "4509", "abcdef"]) {
      const r = await pagar({ cuotas: 6, ...(bin ? { bin } : {}) });
      expect(r.status).toBe(422);
      expect((await r.json()).motivo).toBe("datos_invalidos");
    }
    expect(consultarPlanesMP).not.toHaveBeenCalled();
    sinEfectos();
  });

  it("débito con cuotas → 422 cuotas_no_disponibles", async () => {
    const r = await pagar({ cuotas: 6, bin: "450995", metodoPagoId: "debvisa" });
    expect(r.status).toBe(422);
    expect((await r.json()).motivo).toBe("cuotas_no_disponibles");
    sinEfectos();
  });

  it("pedido sin cuotas congeladas (null) ya no acepta cualquier cantidad: exige el plan", async () => {
    getPedidoParaPago.mockResolvedValue(pedido(null));
    consultarPlanesMP.mockResolvedValue(planes(3));
    const r = await pagar({ cuotas: 7, bin: "450995" });
    expect(r.status).toBe(422);
    sinEfectos();
  });
});
