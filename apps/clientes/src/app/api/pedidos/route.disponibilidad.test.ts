import { beforeEach, describe, expect, it, vi } from "vitest";
import { SucursalPedidoError } from "@/lib/sucursales-pedido";

/**
 * Flag `disponibilidad-sucursal` en POST /api/pedidos: apagado, la cotización no lleva contexto y
 * `crearPedido` valida con la vista 0012; prendido, cotiza con la UNIÓN de las sucursales activas
 * (contexto de la zona elegida) y `crearPedido` recibe `disponibilidadSucursal`; los rechazos de
 * disponibilidad salen 409 en usted con los ids de las líneas.
 */
const disp = {
  zona: "sede-a",
  activas: ["sede-a", "sede-b"],
  contarEn: ["sede-a"],
  stockHeredado: "sede-a",
};
vi.mock("@/lib/zona-servidor", () => ({
  dispDelVisitante: async () => (estadoDisp ? disp : undefined),
}));
vi.mock("@/lib/disponibilidad-vista", () => ({
  contextoParaProvincia: async (base: typeof disp, provincia: string | null) =>
    provincia === "misiones"
      ? { ...base, zona: "sede-a" }
      : provincia
        ? { ...base, zona: "sede-b" }
        : base,
}));
let estadoDisp = false;
const crearPedido = vi.fn();
const cotizar = vi.fn();
let cookieZona: string | undefined;
let provinciaFactura: string | undefined;

vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === "shop_zona" && cookieZona ? { value: cookieZona } : undefined,
  }),
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({
    clerkUserId: "user_1",
    cliente: null,
    email: "a@b.example",
  }),
  idPriceListCliente: async () => undefined,
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
    pais: "AR",
    tipoDoc: "DNI",
    nroDoc: "1",
    razonSocial: "X",
    condicionIva: "CF",
    telefono: "1",
    domicilioProvincia: provinciaFactura ?? null,
  }),
  perfilCompleto: () => true,
  guardarTelefonoSiFalta: async () => {},
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => false }));
// Sin medios cargados: el único pago válido es "a_coordinar".
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => [] }));

import { POST } from "./route";
import { setFlag } from "@/test/flags";

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }],
        contactoNombre: "Ana",
        contactoTelefono: "123",
        entregaTipo: "retiro",
        pagoMetodo: "a_coordinar",
        ...extra,
      }),
    }),
  );
const datosPedido = () => crearPedido.mock.calls[0][1];

beforeEach(() => {
  cookieZona = undefined;
  provinciaFactura = undefined;
  estadoDisp = false;
  crearPedido.mockReset();
  crearPedido.mockResolvedValue({
    id: "p1",
    numero: "PED-1",
    repetido: false,
    cuotas: null,
  });
  cotizar.mockReset();
  cotizar.mockResolvedValue({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal: 100,
    iva: 21,
    costoEnvio: 0,
    total: 121,
  });
});

describe("POST /api/pedidos — disponibilidad por sucursal", () => {
  it("apagado: la cotización no lleva contexto y crearPedido no recibe el flag", async () => {
    setFlag("sucursales", true);
    await post({ sucursalRetiro: "sede-a" });
    expect(cotizar.mock.calls[0][1].disp).toBeUndefined();
    expect(datosPedido().disponibilidadSucursal).toBe(false);
  });

  it("prendido: cotiza con la UNIÓN de las sucursales activas y avisa a crearPedido", async () => {
    setFlag("sucursales", true);
    estadoDisp = true;
    await post({ sucursalRetiro: "sede-a" });
    expect(cotizar.mock.calls[0][1].disp).toEqual({
      zona: "sede-a",
      activas: ["sede-a", "sede-b"],
      contarEn: ["sede-a", "sede-b"],
      stockHeredado: "sede-a",
    });
    expect(datosPedido().disponibilidadSucursal).toBe(true);
  });

  it("envío: la zona del contexto sale de la provincia elegida", async () => {
    setFlag("sucursales", true);
    estadoDisp = true;
    await post({
      entregaTipo: "envio",
      entregaCiudad: "Ciudad",
      entregaDireccion: "Calle 1",
      entregaProvincia: "Córdoba",
    });
    expect(cotizar.mock.calls[0][1].disp.zona).toBe("sede-b");
  });

  it.each([
    [
      "sin_stock",
      "No hay disponibilidad de algunos productos para la sucursal que atiende su pedido. Revise el carrito.",
    ],
    ["no_servible", "El producto ya no está disponible."],
    [
      "sin_retiro",
      "Algunos productos no se ofrecen para retiro en el local seleccionado. Seleccione otro local o el envío a domicilio.",
    ],
  ] as const)(
    "rechazo %s: 409 en usted con el motivo y los ids",
    async (codigo, mensaje) => {
      setFlag("sucursales", true);
      estadoDisp = true;
      crearPedido.mockRejectedValue(
        new SucursalPedidoError(codigo, mensaje, ["1"]),
      );
      const r = await post({ sucursalRetiro: "sede-a" });
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({
        error: mensaje,
        motivo: codigo,
        ids: ["1"],
      });
    },
  );
});
