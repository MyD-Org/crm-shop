import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Monto mínimo por cantidad de cuotas (change `payway-cobro`, rebanada 0). El servidor cotiza
 * primero a la lista del PAGO ÚNICO del medio (la base) y rechaza (422) una cantidad cuyo mínimo no
 * alcanza esa base; recién después cotiza con la lista de las N cuotas. Nada del body decide el mínimo.
 */

const crearPedido = vi.fn();
const cotizar = vi.fn();
let minimo6: number | null = 60000;
const TOTAL_POR_LISTA: Record<string, number> = { L1: 60000, L3: 60500, L6: 61000 };

vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@b.com" }),
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({
    pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF", telefono: null,
  }),
  perfilCompleto: () => true,
  guardarTelefonoSiFalta: async () => undefined,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () => [
    {
      slug: "mercadopago",
      nombre: "Mercado Pago",
      instrucciones: "",
      activo: true,
      aplicaRetiro: true,
      aplicaEnvio: true,
      cobroOnline: true,
      orden: 0,
      idListaPrecios: "L1",
      condicionesCuotas: [
        { cuotas: 3, idListaPrecios: "L3", montoMinimo: null },
        { cuotas: 6, idListaPrecios: "L6", montoMinimo: minimo6 },
      ],
    },
  ],
}));

import { POST } from "./route";

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }],
        contactoNombre: "Ana",
        contactoTelefono: "123",
        entregaTipo: "retiro",
        pagoMetodo: "mercadopago",
        ...extra,
      }),
    }),
  );

const listasCotizadas = () => cotizar.mock.calls.map((c) => (c[1] as { idListaMedio?: string }).idListaMedio);

beforeEach(() => {
  vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-key");
  minimo6 = 60000;
  TOTAL_POR_LISTA.L1 = 60000;
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, datos) => ({
    id: "p1", numero: "PED-1", repetido: false, cuotas: datos.cuotas ?? null,
  }));
  cotizar.mockReset();
  cotizar.mockImplementation(async (_l: unknown, o: { idListaMedio?: string }) => ({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal: 0,
    iva: 0,
    costoEnvio: 0,
    total: TOTAL_POR_LISTA[o.idListaMedio ?? "L1"] ?? 60000,
  }));
});

describe("POST /api/pedidos — monto mínimo de las cuotas", () => {
  it("un cliente que fuerza 6 cuotas con un contado bajo el mínimo: 422 y no se crea pedido", async () => {
    TOTAL_POR_LISTA.L1 = 30000;
    const r = await post({ cuotas: 6 });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ motivo: "cuotas_no_disponibles" });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("justo en el mínimo: se acepta, cotiza primero la base (pago único) y después la lista de las 6 cuotas", async () => {
    const r = await post({ cuotas: 6 });
    expect(r.status).toBe(201);
    expect(listasCotizadas()).toEqual(["L1", "L6"]);
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ cuotas: 6 });
  });

  it("un centavo menos que el mínimo: 422", async () => {
    TOTAL_POR_LISTA.L1 = 59999.99;
    expect((await post({ cuotas: 6 })).status).toBe(422);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("una cantidad sin mínimo se acepta con un contado bajo", async () => {
    TOTAL_POR_LISTA.L1 = 1000;
    const r = await post({ cuotas: 3 });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ cuotas: 3 });
  });

  it("un pago sigue entrando aunque haya mínimos", async () => {
    TOTAL_POR_LISTA.L1 = 1000;
    const r = await post();
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ cuotas: 1 });
  });

  it("sin ningún mínimo cargado no hay cotización extra (la de siempre)", async () => {
    minimo6 = null;
    const r = await post({ cuotas: 6 });
    expect(r.status).toBe(201);
    expect(listasCotizadas()).toEqual(["L6"]);
  });
});
