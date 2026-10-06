import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cuotas sin interés congeladas al crear el pedido (rebanada D): la cantidad sale del body pero el
 * servidor sólo la acepta si el medio (con cobro en línea) tiene una condición para ella; la lista de
 * esa condición cotiza el pedido. Nada de montos ni listas se lee del body.
 */

const crearPedido = vi.fn();
const guardarTelefonoSiFalta = vi.fn();
let flag = true;
let pais = "AR";
let telefonoPerfil: string | null = null;
let perfilCompletoMock = true;

// El límite por comprador se prueba en route.rate-limit.test.ts: acá los
// casos repiten el mismo usuario muchas veces.
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@b.com" }),
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
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => flag }));
// Medios del CRM (`medios_pago_shop`): los tres de siempre; mercadopago es la fila fija con cobro online.
const mediosCrm = ["transferencia", "efectivo", "mercadopago"].map((slug, orden) => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: slug !== "efectivo",
  cobroOnline: slug === "mercadopago",
  orden,
  idListaPrecios: slug === "mercadopago" ? "L1" : null,
  condicionesCuotas:
    slug === "mercadopago"
      ? [
          { cuotas: 3, idListaPrecios: "L3" },
          { cuotas: 6, idListaPrecios: "L6" },
        ]
      : [],
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => mediosCrm }));
// Con credenciales de Mercado Pago (sin ellas el medio se rechaza: route.medios.test.ts).

import { POST } from "./route";
import { StockInsuficienteError } from "@/lib/stock-disponible";

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

const datosGuardados = () => crearPedido.mock.calls[0][1] as { cuotas?: number | null };
const listaCotizada = () => (cotizar.mock.calls[0][1] as { idListaMedio?: string }).idListaMedio;

beforeEach(() => {
  vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-key");
  flag = true;
  pais = "AR";
  telefonoPerfil = null;
  perfilCompletoMock = true;
  guardarTelefonoSiFalta.mockReset();
  guardarTelefonoSiFalta.mockResolvedValue(undefined);
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, datos) => ({
    id: "p1", numero: "PED-1", repetido: false, cuotas: datos.cuotas ?? null,
  }));
  cotizar.mockReset();
  cotizar.mockResolvedValue(COTIZACION_OK);
  getPedidoPorClave.mockReset();
  getPedidoPorClave.mockResolvedValue(null);
});

describe("POST /api/pedidos — cuotas sin interés congeladas", () => {
  it("N cuotas con condición: cotiza con la lista de esa condición y congela N", async () => {
    const r = await post({ cuotas: 6 });
    expect(r.status).toBe(201);
    expect(listaCotizada()).toBe("L6");
    expect(datosGuardados().cuotas).toBe(6);
    expect(await r.json()).toMatchObject({ cuotas: 6 });
  });

  it("sin cuotas en el body: un pago (1), con la lista del pago único", async () => {
    await post();
    expect(listaCotizada()).toBe("L1");
    expect(datosGuardados().cuotas).toBe(1);
  });

  it("una cantidad sin condición se rechaza (422) y no crea ni cotiza", async () => {
    const r = await post({ cuotas: 12 });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe("La cantidad de cuotas elegida ya no está disponible. Seleccione otra.");
    expect(crearPedido).not.toHaveBeenCalled();
    expect(cotizar).not.toHaveBeenCalled();
  });

  it.each(["6", 3.5, 0, -1, {}])("cuotas %j inválidas: 422", async (cuotas) => {
    expect((await post({ cuotas })).status).toBe(422);
  });

  it("ignora la lista, el monto y el plan viejo que vengan en el body", async () => {
    await post({ cuotas: 3, idListaMedio: "X", idPriceList: "Y", total: 1, cuotasMax: 24, cuotasPlan: { cuotasMax: 24 } });
    expect(listaCotizada()).toBe("L3");
    expect(datosGuardados().cuotas).toBe(3);
  });

  it("flag apagado: no hay cuotas (null), se ignora el body y rige la lista del pago único", async () => {
    flag = false;
    const r = await post({ cuotas: 6 });
    expect(r.status).toBe(201);
    expect(datosGuardados().cuotas).toBeNull();
    expect(listaCotizada()).toBe("L1");
    expect((await r.json()).cuotas).toBeNull();
  });

  it("medio sin cobro en línea: sin cuotas aunque el body las pida", async () => {
    const r = await post({ pagoMetodo: "transferencia", cuotas: 6 });
    expect(r.status).toBe(201);
    expect(datosGuardados().cuotas).toBeNull();
  });

  it("totalVisto distinto del recotizado con esa cantidad de cuotas: 409 precio_cambio y no crea", async () => {
    const r = await post({ cuotas: 6, totalVisto: 100000 });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("precio_cambio");
    expect(crearPedido).not.toHaveBeenCalled();
  });
});

describe("POST /api/pedidos — envío solo dentro de Argentina", () => {
  const conEnvio = { entregaTipo: "envio", entregaCiudad: "Puerto Iguazú", entregaDireccion: "Calle 1", entregaProvincia: "Misiones" };

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
