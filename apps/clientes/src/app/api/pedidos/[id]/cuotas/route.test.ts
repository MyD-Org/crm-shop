import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoPlanesMP } from "@/lib/pagos/mercadopago-planes";

/**
 * Opciones de cuotas del formulario de pago para un pedido propio. Sin efectos: sólo lee el pedido, los
 * medios y cotiza; nunca cambia el pedido. Los planes con interés de Mercado Pago salen del servidor.
 */

const pedidoParaCambiarMedio = vi.fn();
const identidadActual = vi.fn();
const cotizar = vi.fn();
const consultarPlanesMP = vi.fn(async (..._a: unknown[]): Promise<ResultadoPlanesMP> => ({ ok: false }));
const cambiarMedioPedido = vi.fn();
let permitido = true;
let cuotasFlag = true;
let medios: unknown[] = [];

vi.mock("@/lib/rate-limit", () => ({ permitir: () => permitido }));
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/catalogo-flag", () => ({ catalogoSoloVisibles: async () => false }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => cuotasFlag }));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/pagos/mercadopago-planes", () => ({ consultarPlanesMP: (...a: unknown[]) => consultarPlanesMP(...a) }));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  cuentasRechazadasDelPedido: async () => [],
  pedidoParaCambiarMedio: (...a: unknown[]) => pedidoParaCambiarMedio(...a),
  cambiarMedioPedido: (...a: unknown[]) => cambiarMedioPedido(...a),
}));

import { POST } from "./route";

/** Total por lista (sin lista = referencia). */
const TOTALES: Record<string, number> = { ref: 50_000, l1: 50_000, l3: 52_000, l6: 54_000 };

const medioMP = {
  slug: "mercadopago",
  nombre: "Mercado Pago",
  activo: true,
  cobroOnline: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  idListaPrecios: "l1",
  condicionesCuotas: [
    { cuotas: 3, idListaPrecios: "l3", montoMinimo: null, marcas: null },
    { cuotas: 6, idListaPrecios: "l6", montoMinimo: 100_000, marcas: null },
  ],
};

const lineasDelPedido = [{ id: "item-9", qty: 3 }];
const pedido = (extra: Record<string, unknown> = {}) => ({
  entregaTipo: "retiro",
  pagoMetodo: "mercadopago",
  lineas: lineasDelPedido,
  cuotas: 1,
  total: 50_000,
  sucursal: "mdp",
  facturaSucursal: null,
  avisosEnviados: false,
  entrega: { local: null, ciudad: null, direccion: null },
  contacto: { nombre: "Ana", telefono: "1100000000" },
  ...extra,
});

const planes = (...cuotas: number[]): ResultadoPlanesMP => ({
  ok: true,
  entrada: {
    metodoPagoId: "visa",
    emisor: null,
    logo: "https://logos.example/visa.png",
    planes: cuotas.map((n) => ({ cuotas: n, montoCuota: 10_000, total: 10_000 * n, tasaPct: 10, cft: "1,00", tea: "2,00", conInteres: true })),
  },
});

const llamar = (body: unknown = {}, id = "p1") =>
  POST(new Request(`https://tienda.example/api/pedidos/${id}/cuotas`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  // Dos cuentas de Mercado Pago; el pedido es de mdp.
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-de-prueba");
  vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-clave-publica");
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-otra-cuenta");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-clave-publica-otra-cuenta");
  permitido = true;
  cuotasFlag = true;
  medios = [medioMP];
  for (const f of [pedidoParaCambiarMedio, cotizar, consultarPlanesMP, cambiarMedioPedido]) f.mockReset();
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  pedidoParaCambiarMedio.mockResolvedValue(pedido());
  cotizar.mockImplementation(async (_l: unknown, o: { idListaMedio?: string }) => {
    const total = TOTALES[o.idListaMedio ?? "ref"];
    // Una línea con el total: la cotización del pedido ignora el stock y recalcula desde las líneas.
    const linea = { id: "item-9", qty: 3, subtotal: total, iva: 0, total };
    return { lineas: [linea], subtotal: total, iva: 0, costoEnvio: 0, total, hayProblemas: false, listaPrivada: false };
  });
  consultarPlanesMP.mockResolvedValue({ ok: false });
});

describe("POST /api/pedidos/[id]/cuotas", () => {
  it("sin sesión → 401", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await llamar()).status).toBe(401);
  });

  it("pedido ajeno o inexistente → 404 genérico, sin datos", async () => {
    pedidoParaCambiarMedio.mockResolvedValue(null);
    const r = await llamar();
    expect(r.status).toBe(404);
    expect(Object.keys(await r.json())).toEqual(["error"]);
  });

  it("rate-limit → 429", async () => {
    permitido = false;
    expect((await llamar()).status).toBe(429);
  });

  it("BIN o marca inválidos → 400", async () => {
    expect((await llamar({ bin: "45" })).status).toBe(400);
    expect((await llamar({ marca: "tarjeta-x" })).status).toBe(400);
  });

  it("pedido retomado: cotiza las líneas del PEDIDO; sin efectos sobre el pedido", async () => {
    await llamar();
    expect(cotizar).toHaveBeenCalled();
    for (const [lineas] of cotizar.mock.calls) expect(lineas).toBe(lineasDelPedido);
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("mínimo no alcanzado: 6 cuotas (mín. $100.000) no figura", async () => {
    const json = await (await llamar()).json();
    expect(json.opciones.map((o: { cuotas: number }) => o.cuotas)).toEqual([1, 3]);
    expect(json.precioUnPago).toBe(50_000);
    expect(json.actual).toEqual({ cuotas: 1, total: 50_000 });
  });

  it("sin tarjeta: planes de referencia de Visa; con interés disponible; public key del resolver", async () => {
    consultarPlanesMP.mockResolvedValue(planes(6, 12));
    const json = await (await llamar()).json();
    expect(consultarPlanesMP).toHaveBeenCalledWith(expect.objectContaining({ amount: 50_000, paymentMethodId: "visa", cuenta: "mdp" }));
    expect(json.procesador).toEqual({ id: "mercadopago", nombre: "Mercado Pago" });
    expect(json.publicKey).toBe("TEST-clave-publica");
    expect(json.conInteres).toEqual({ disponible: true });
    expect(json.marca).toBeNull();
    expect(json.opciones.map((o: { cuotas: number; tipo: string }) => `${o.cuotas}:${o.tipo}`)).toEqual([
      "1:un_pago",
      "3:sin_interes",
      "6:con_interes",
      "12:con_interes",
    ]);
  });

  it("con BIN: planes de la tarjeta y su marca", async () => {
    consultarPlanesMP.mockResolvedValue(planes(6));
    const json = await (await llamar({ bin: "45099512" })).json();
    expect(consultarPlanesMP).toHaveBeenCalledWith(expect.objectContaining({ amount: 50_000, bin: "45099512", cuenta: "mdp" }));
    expect(json.marca).toEqual({ id: "visa", nombre: "Visa", logo: "https://logos.example/visa.png" });
  });

  it("marca no incluida en una condición → restringidas", async () => {
    medios = [
      {
        ...medioMP,
        condicionesCuotas: [{ cuotas: 3, idListaPrecios: "l3", montoMinimo: null, marcas: ["visa", "mastercard"] }],
      },
    ];
    consultarPlanesMP.mockResolvedValue({ ok: true, entrada: { metodoPagoId: "amex", emisor: null, logo: null, planes: [] } });
    const json = await (await llamar({ bin: "37118030" })).json();
    expect(json.marca.id).toBe("amex");
    expect(json.opciones.map((o: { cuotas: number }) => o.cuotas)).toEqual([1]);
    expect(json.restringidas).toEqual([{ cuotas: 3, marcas: ["visa", "mastercard"] }]);
  });

  it("MP no responde: conInteres.disponible=false y quedan 1 pago + sin interés", async () => {
    const json = await (await llamar({ bin: "450995" })).json();
    expect(json.conInteres).toEqual({ disponible: false });
    expect(json.opciones.map((o: { tipo: string }) => o.tipo)).toEqual(["un_pago", "sin_interes"]);
  });

  it("la zona que fuerza la factura manda: planes y public key de la cuenta que factura", async () => {
    pedidoParaCambiarMedio.mockResolvedValue(pedido({ sucursal: "mdp", facturaSucursal: "igz" }));
    consultarPlanesMP.mockResolvedValue(planes(3));
    const json = await (await llamar()).json();
    expect(consultarPlanesMP).toHaveBeenCalledWith(expect.objectContaining({ cuenta: "igz" }));
    expect(json.publicKey).toBe("TEST-clave-publica-otra-cuenta");
  });

  it("la cuenta del pedido sin credenciales: sin planes con interés ni public key (no los de otra cuenta)", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    const json = await (await llamar()).json();
    expect(consultarPlanesMP).not.toHaveBeenCalled();
    expect(json.publicKey).toBeUndefined();
    expect(json.conInteres).toEqual({ disponible: false });
  });

  it("Payway: sin planes de MP; la marca viene explícita", async () => {
    medios = [{ ...medioMP, slug: "payway", nombre: "Tarjeta" }];
    pedidoParaCambiarMedio.mockResolvedValue(pedido({ pagoMetodo: "payway" }));
    const json = await (await llamar({ marca: "naranja" })).json();
    expect(consultarPlanesMP).not.toHaveBeenCalled();
    expect(json.procesador.id).toBe("payway");
    expect(json.publicKey).toBeUndefined();
    expect(json.conInteres).toEqual({ disponible: false });
    expect(json.marca).toMatchObject({ id: "naranja", nombre: "Naranja" });
  });

  it("flag de cuotas sin interés apagado: sólo 1 pago y las de MP", async () => {
    cuotasFlag = false;
    consultarPlanesMP.mockResolvedValue(planes(6));
    const json = await (await llamar()).json();
    expect(json.opciones.map((o: { cuotas: number; tipo: string }) => `${o.cuotas}:${o.tipo}`)).toEqual([
      "1:un_pago",
      "6:con_interes",
    ]);
  });

  it("pedido de un medio sin cobro en línea → 409", async () => {
    pedidoParaCambiarMedio.mockResolvedValue(pedido({ pagoMetodo: "transferencia" }));
    expect((await llamar()).status).toBe(409);
  });
});
