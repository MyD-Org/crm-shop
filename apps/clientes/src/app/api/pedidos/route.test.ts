import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * Plan de cuotas congelado al crear el pedido (L8): lo resuelve el server con
 * el total re-cotizado y la oferta de la DB. Nada de cuotas se lee del body.
 */

const crearPedido = vi.fn();
const getOferta = vi.fn();
let flag = true;
let pais = "AR";

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@b.com" }),
  idPriceListDe: async () => undefined,
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: async () => ({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal: 165289.26,
    iva: 34710.74,
    costoEnvio: 0,
    total: 200000,
  }),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais, tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
vi.mock("@/lib/facturacion", async (original) => ({
  // `admiteEnvio` es la regla real: mockearla sería testear el mock.
  admiteEnvio: (await original<typeof import("@/lib/facturacion")>()).admiteEnvio,
  domicilioEnLinea: () => "",
}));
vi.mock("@/lib/cuotas-datos", () => ({ getOfertaCuotasParaPedido: () => getOferta() }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => flag }));
// Estos tests son del flujo CON cobros: corren con los pagos prendidos, que es
// cómo se comportaba la ruta antes del flag de pagos. El flag apagado se prueba
// aparte, en route.pagos-flag.test.ts.
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => true }));

import { POST } from "./route";

const ofertaCon6Desde150k: OfertaCuotas = {
  planesFetchedAt: null,
  configVersion: null,
  proveedores: [
    {
      proveedor: "mercadopago", nombre: "Mercado Pago", orden: 0,
      escalones: [{ cuotasMax: 6, montoMinimo: 150000 }],
      opciones: [{ cuotas: 6, sinInteres: true, tasaPct: 0, cftPct: null, teaPct: null, montoMin: null, montoMax: null }],
    },
  ],
};

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

const planGuardado = () => crearPedido.mock.calls[0][3];

beforeEach(() => {
  flag = true;
  pais = "AR";
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, _d, _cot, plan) => ({
    id: "p1", numero: "PED-1", repetido: false, cuotasMax: plan?.cuotasMax ?? null,
  }));
  getOferta.mockReset();
});

describe("POST /api/pedidos — plan de cuotas congelado", () => {
  it("calcula sobre el total del server e ignora cuotas del body", async () => {
    getOferta.mockResolvedValue(ofertaCon6Desde150k);
    const r = await post({ cuotasMax: 24, cuotas_max: 24, cuotasPlan: { cuotasMax: 24 } });
    expect(r.status).toBe(201);
    expect(planGuardado()).toMatchObject({ version: "v2", proveedor: "mercadopago", cuotasMax: 6, totalBase: 200000 });
    expect(await r.json()).toMatchObject({ cuotasMax: 6 });
  });

  it("oferta leíble sin escalón alcanzado para el total → cuotasMax 1", async () => {
    getOferta.mockResolvedValue({ ...ofertaCon6Desde150k, proveedores: [{ ...ofertaCon6Desde150k.proveedores[0], escalones: [{ cuotasMax: 6, montoMinimo: 300000 }] }] });
    await post();
    expect(planGuardado()).toMatchObject({ cuotasMax: 1 });
  });

  it("oferta ilegible (null) → plan null (cuotas_max null, legacy)", async () => {
    getOferta.mockResolvedValue(null);
    await post();
    expect(planGuardado()).toBeNull();
  });

  it("getOferta que tira → plan null y el pedido se crea igual", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getOferta.mockRejectedValue(new Error("db"));
    const r = await post();
    expect(r.status).toBe(201);
    expect(planGuardado()).toBeNull();
  });

  it("medio offline → no consulta la oferta ni congela plan", async () => {
    await post({ pagoMetodo: "transferencia" });
    expect(getOferta).not.toHaveBeenCalled();
    expect(planGuardado()).toBeNull();
  });

  it("flag apagado: congela igual, pero no expone cuotasMax al cliente", async () => {
    flag = false;
    getOferta.mockResolvedValue(ofertaCon6Desde150k);
    const r = await post();
    expect(planGuardado()).toMatchObject({ cuotasMax: 6 });
    expect((await r.json()).cuotasMax).toBeNull();
  });
});

describe("POST /api/pedidos — envío solo dentro de Argentina", () => {
  const conEnvio = { entregaTipo: "envio", entregaCiudad: "Puerto Iguazú", entregaDireccion: "Calle 1" };

  it("rechaza el envío a un comprador con documento de otro país", async () => {
    pais = "BR";
    const r = await post({ ...conEnvio, pagoMetodo: "transferencia" });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("envio_no_disponible_pais");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("al mismo comprador le acepta el retiro", async () => {
    pais = "PY";
    const r = await post({ pagoMetodo: "transferencia" });
    expect(r.status).toBeLessThan(300);
    expect(crearPedido).toHaveBeenCalled();
  });
});
