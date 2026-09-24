import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * Plan de cuotas congelado al crear el pedido (L8): lo resuelve el server con
 * el total re-cotizado y la oferta de la DB. Nada de cuotas se lee del body.
 */

const crearPedido = vi.fn();
const getOferta = vi.fn();
const guardarTelefonoSiFalta = vi.fn();
let flag = true;
let pais = "AR";
let telefonoPerfil: string | null = null;
let perfilCompletoMock = true;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@b.com" }),
  idPriceListCliente: async () => undefined,
}));
const COTIZACION_OK = {
  lineas: [{ id: "1", qty: 1 }],
  hayProblemas: false,
  subtotal: 165289.26,
  iva: 34710.74,
  costoEnvio: 0,
  total: 200000,
};
const cotizar = vi.fn();
const getPedidoPorClave = vi.fn();
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: (...a: unknown[]) => getPedidoPorClave(...a),
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({
    pais, tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF", telefono: telefonoPerfil,
  }),
  perfilCompleto: () => perfilCompletoMock,
  guardarTelefonoSiFalta: (...a: unknown[]) => guardarTelefonoSiFalta(...a),
}));
// `@/lib/facturacion` es la real (`admiteEnvio` incluida): mockearla sería testear el mock.
vi.mock("@/lib/cuotas-datos", () => ({ getOfertaCuotasParaPedido: () => getOferta() }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => flag }));
// Estos tests son del flujo CON cobros: corren con los pagos prendidos, que es
// cómo se comportaba la ruta antes del flag de pagos. El flag apagado se prueba
// aparte, en route.pagos-flag.test.ts.
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => true }));

import { POST } from "./route";
import { StockInsuficienteError } from "@/lib/stock-disponible";
import { setFlag } from "@/test/flags";

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
  // Estos casos ejercitan el envío propio: el flag `envio` prendido.
  setFlag("envio", true);
  flag = true;
  pais = "AR";
  telefonoPerfil = null;
  perfilCompletoMock = true;
  guardarTelefonoSiFalta.mockReset();
  guardarTelefonoSiFalta.mockResolvedValue(undefined);
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, _d, _cot, plan) => ({
    id: "p1", numero: "PED-1", repetido: false, cuotasMax: plan?.cuotasMax ?? null,
  }));
  getOferta.mockReset();
  cotizar.mockReset();
  cotizar.mockResolvedValue(COTIZACION_OK);
  getPedidoPorClave.mockReset();
  getPedidoPorClave.mockResolvedValue(null);
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

describe("POST /api/pedidos — flag envio apagado", () => {
  it("rechaza el envío a domicilio y acepta el retiro", async () => {
    setFlag("envio", false);
    const envio = await post({
      entregaTipo: "envio",
      entregaCiudad: "Puerto Iguazú",
      entregaDireccion: "Calle 1",
      pagoMetodo: "transferencia",
    });
    expect(envio.status).toBe(409);
    expect((await envio.json()).motivo).toBe("envio_no_disponible");
    expect(crearPedido).not.toHaveBeenCalled();

    const retiro = await post({ pagoMetodo: "transferencia" });
    expect(retiro.status).toBeLessThan(300);
  });
});

describe("POST /api/pedidos — el perfil aprende el teléfono", () => {
  it("sin teléfono en el perfil, guarda el del pedido", async () => {
    const r = await post({ contactoTelefono: "+54 376 4000000" });
    expect(r.status).toBe(201);
    expect(guardarTelefonoSiFalta).toHaveBeenCalledWith("user_1", "+54 376 4000000");
  });

  it("con teléfono ya cargado no lo pisa", async () => {
    telefonoPerfil = "+54 376 5000000";
    await post({ contactoTelefono: "+54 376 4000000" });
    expect(guardarTelefonoSiFalta).not.toHaveBeenCalled();
  });

  it("si falla el guardado, el pedido se responde igual", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    guardarTelefonoSiFalta.mockRejectedValue(new Error("db"));
    const r = await post();
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ numero: "PED-1" });
  });
});


describe("POST /api/pedidos — sin stock suficiente al confirmar", () => {
  const CLAVE = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const SIN_STOCK = {
    ...COTIZACION_OK,
    lineas: [{ id: "1", qty: 1, stockDisponible: 0, problema: "sin_stock", detalle: "Sin stock." }],
    hayProblemas: true,
  };

  it("otro checkout se llevó la última unidad: re-cotiza y responde el 409 con la cotización nueva", async () => {
    crearPedido.mockRejectedValue(new StockInsuficienteError(["1"]));
    cotizar.mockResolvedValueOnce(COTIZACION_OK).mockResolvedValueOnce(SIN_STOCK);
    const r = await post();
    expect(r.status).toBe(409);
    expect(cotizar).toHaveBeenCalledTimes(2);
    expect(await r.json()).toEqual({
      error: "Algunos productos cambiaron. Revise el detalle antes de confirmar.",
      cotizacion: SIN_STOCK,
    });
  });

  it("si la re-cotización también falla, es el 500 de siempre (en usted)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crearPedido.mockRejectedValue(new StockInsuficienteError(["1"]));
    cotizar.mockResolvedValueOnce(COTIZACION_OK).mockRejectedValueOnce(new Error("db"));
    const r = await post();
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe("No pudimos registrar el pedido. Inténtelo de nuevo en un momento.");
  });

  it("reintento cuyo primer intento se creó mientras se cotizaba: devuelve el pedido, no un 409 por su propia reserva", async () => {
    cotizar.mockResolvedValue(SIN_STOCK);
    getPedidoPorClave
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "p0", numero: "PED-0", cuotasMax: null });
    const r = await post({ idempotencyKey: CLAVE });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: "p0", numero: "PED-0", repetido: true });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("sin clave, un problema de stock es el 409 de siempre sin buscar pedidos", async () => {
    cotizar.mockResolvedValue(SIN_STOCK);
    const r = await post();
    expect(r.status).toBe(409);
    expect(getPedidoPorClave).not.toHaveBeenCalled();
  });
});

describe("POST /api/pedidos — textos en usted", () => {
  it("faltan los datos de facturación", async () => {
    perfilCompletoMock = false;
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({
      error: "Cargue sus datos de facturación para continuar.",
      motivo: "facturacion_incompleta",
    });
  });

  it("error inesperado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crearPedido.mockRejectedValue(new Error("db"));
    const r = await post();
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe("No pudimos registrar el pedido. Inténtelo de nuevo en un momento.");
  });
});
