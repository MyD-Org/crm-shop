import { beforeEach, describe, expect, it, vi } from "vitest";
import { SucursalPedidoError } from "@/lib/sucursales-pedido";

/**
 * Flag `sucursales` en POST /api/pedidos: apagado, `crearPedido` no recibe entrada de sucursal;
 * prendido, la recibe con la provincia (body > cookie de zona > domicilio de facturación) y el
 * local de retiro; un error de reglas se responde 409 en usted.
 */
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
vi.mock("@/lib/cuotas-datos", () => ({
  getOfertaCuotasParaPedido: async () => null,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => false }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => false }));

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
  crearPedido.mockReset();
  crearPedido.mockResolvedValue({
    id: "p1",
    numero: "PED-1",
    repetido: false,
    cuotasMax: null,
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

describe("POST /api/pedidos — sucursales", () => {
  it("flag apagado: no se pasa entrada de sucursal", async () => {
    const r = await post({ sucursalRetiro: "sede-a" });
    expect(r.status).toBe(201);
    expect(datosPedido().sucursalEntrada).toBeUndefined();
  });

  it("flag prendido, retiro: pasa el local elegido", async () => {
    setFlag("sucursales", true);
    await post({ sucursalRetiro: "sede-a" });
    expect(datosPedido().sucursalEntrada).toMatchObject({
      entregaTipo: "retiro",
      sucursalRetiro: "sede-a",
    });
  });

  it("provincia: la del body gana a la cookie de zona, y ésta al domicilio de facturación", async () => {
    setFlag("sucursales", true);
    cookieZona = "cordoba";
    provinciaFactura = "Misiones";
    await post({ entregaProvincia: "Tucumán" });
    expect(datosPedido().sucursalEntrada.provincia).toBe("tucuman");
    crearPedido.mockClear();
    await post();
    expect(datosPedido().sucursalEntrada.provincia).toBe("cordoba");
    crearPedido.mockClear();
    cookieZona = undefined;
    await post();
    expect(datosPedido().sucursalEntrada.provincia).toBe("misiones");
  });

  it("cookie con provincia inválida: se ignora", async () => {
    setFlag("sucursales", true);
    cookieZona = "atlantida";
    await post();
    expect(datosPedido().sucursalEntrada.provincia).toBeNull();
  });

  it("rechazo de reglas: 409 en usted con el motivo", async () => {
    setFlag("sucursales", true);
    crearPedido.mockRejectedValue(
      new SucursalPedidoError(
        "sin_retiro",
        "La sucursal seleccionada no admite retiro. Seleccione otro local de retiro.",
      ),
    );
    const r = await post({ sucursalRetiro: "sede-a" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({
      motivo: "sin_retiro",
      error: expect.stringContaining("Seleccione"),
    });
  });
});
