import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ENVIO_DEFAULT, type ConfigEnvio } from "@/lib/envio";

/**
 * Envío a domicilio configurable (change `envio-gratis-configurable`): el servidor relee la
 * configuración SIN caché y decide con ella. Un envío a domicilio nunca se rechaza por no ser
 * gratis (se crea con costo 0, a coordinar); sólo si el admin lo desactivó. La provincia sale del
 * cuerpo del pedido y es obligatoria para el domicilio.
 */

const crearPedido = vi.fn();
let config: ConfigEnvio = CONFIG_ENVIO_DEFAULT;
let subtotal = 120_000;

vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
  idPriceListCliente: async () => undefined,
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: async () => ({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal,
    iva: 0,
    costoEnvio: 0,
    total: subtotal,
  }),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
vi.mock("@/lib/cuotas-datos", () => ({ getOfertaCuotasParaPedido: async () => null }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => true }));
vi.mock("@/lib/sucursales-repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => config,
}));

import { POST } from "./route";

const conEnvio = {
  entregaTipo: "envio",
  entregaCiudad: "Posadas",
  entregaDireccion: "Calle 1",
  entregaProvincia: "Misiones",
  pagoMetodo: "transferencia",
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
        pagoMetodo: "transferencia",
        ...extra,
      }),
    }),
  );

const datosGuardados = () => crearPedido.mock.calls[0][1];

const GRATIS_MISIONES: ConfigEnvio = {
  domicilioActivo: true,
  gratis: { alcance: "provincias", provincias: ["misiones"], minimo: 100_000 },
};

beforeEach(() => {
  config = CONFIG_ENVIO_DEFAULT;
  subtotal = 120_000;
  crearPedido.mockReset();
  crearPedido.mockImplementation(async () => ({ id: "p1", numero: "PED-1", repetido: false, cuotasMax: null }));
});

describe("POST /api/pedidos — envío a domicilio configurable", () => {
  it("con el envío gratis apagado crea el pedido a coordinar (envioGratis=false), no lo rechaza", async () => {
    const r = await post(conEnvio);
    expect(r.status).toBeLessThan(300);
    expect(datosGuardados()).toMatchObject({ entregaTipo: "envio", envioGratis: false });
  });

  it("en alcance y sobre el mínimo: envioGratis=true", async () => {
    config = GRATIS_MISIONES;
    expect((await post(conEnvio)).status).toBeLessThan(300);
    expect(datosGuardados().envioGratis).toBe(true);
  });

  it("bajo el mínimo o fuera de alcance: se crea igual, a coordinar", async () => {
    config = GRATIS_MISIONES;
    subtotal = 50_000;
    expect((await post(conEnvio)).status).toBeLessThan(300);
    expect(datosGuardados().envioGratis).toBe(false);

    crearPedido.mockClear();
    subtotal = 500_000;
    expect((await post({ ...conEnvio, entregaProvincia: "Salta" })).status).toBeLessThan(300);
    expect(datosGuardados().envioGratis).toBe(false);
  });

  it("si el admin lo desactivó entre cotizar y pedir: 409 envio_inactivo y retiro sigue andando", async () => {
    config = { domicilioActivo: false, gratis: null };
    const r = await post(conEnvio);
    expect(r.status).toBe(409);
    const json = await r.json();
    expect(json.motivo).toBe("envio_inactivo");
    expect(json.error).toBe("El envío a domicilio no está disponible. Elija retiro en el local.");
    expect(crearPedido).not.toHaveBeenCalled();

    expect((await post()).status).toBeLessThan(300);
    expect(datosGuardados().envioGratis).toBeNull();
  });

  it("la provincia canónica es obligatoria para el domicilio (400)", async () => {
    const sin = await post({ ...conEnvio, entregaProvincia: undefined });
    expect(sin.status).toBe(400);
    const rara = await post({ ...conEnvio, entregaProvincia: "Narnia" });
    expect(rara.status).toBe(400);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("acepta la provincia como clave de zona", async () => {
    config = GRATIS_MISIONES;
    expect((await post({ ...conEnvio, entregaProvincia: "misiones" })).status).toBeLessThan(300);
    expect(datosGuardados().envioGratis).toBe(true);
  });

  it("un envío sin ciudad ni dirección ya no existe: 400", async () => {
    const r = await post({ entregaTipo: "envio", entregaProvincia: "Misiones" });
    expect(r.status).toBe(400);
  });
});
