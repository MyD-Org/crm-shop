import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La validación del medio de pago la decide el server con el flag de ESE
 * momento, sin importar qué haya ofrecido la pantalla. Se prueban las dos
 * direcciones: con los pagos apagados no entra ningún método real (un POST a
 * mano con "mercadopago" no puede crear un pedido cobrable), y con los pagos
 * prendidos no entra "a_coordinar".
 */

const crearPedido = vi.fn();
const getOferta = vi.fn();
let pagos = false;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
  idPriceListCliente: async () => undefined,
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
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
// `@/lib/facturacion` es la real (`admiteEnvio` incluida): mockearla sería testear el mock.
vi.mock("@/lib/cuotas-datos", () => ({ getOfertaCuotasParaPedido: () => getOferta() }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => pagos }));

import { POST } from "./route";
import { setFlag } from "@/test/flags";

const NO_DISPONIBLE = "Ese medio de pago no está disponible para la entrega elegida.";

const post = (extra: Record<string, unknown> = {}) => {
  const body: Record<string, unknown> = {
    items: [{ id: "1", qty: 1 }],
    contactoNombre: "Ana",
    contactoTelefono: "123",
    entregaTipo: "retiro",
    ...extra,
  };
  return POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
};

beforeEach(() => {
  // Estos casos ejercitan el envío propio: el flag `envio` prendido.
  setFlag("envio", true);
  pagos = false;
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, _d, _cot, plan) => ({
    id: "p1", numero: "PED-1", repetido: false, cuotasMax: plan?.cuotasMax ?? null,
  }));
  getOferta.mockReset();
});

describe("POST /api/pedidos — pagos apagados", () => {
  it.each(["mercadopago", "transferencia", "efectivo", "cuenta_corriente"])(
    "rechaza %s con el 400 de siempre y no crea nada",
    async (pagoMetodo) => {
      const r = await post({ pagoMetodo });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
      expect(crearPedido).not.toHaveBeenCalled();
    },
  );

  it("tampoco los acepta con envío a domicilio", async () => {
    const r = await post({
      pagoMetodo: "mercadopago",
      entregaTipo: "envio",
      entregaCiudad: "Puerto Iguazú",
      entregaDireccion: "Calle 1",
    });
    expect(r.status).toBe(400);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("acepta a_coordinar y lo guarda sin nada de cobro", async () => {
    const r = await post({ pagoMetodo: "a_coordinar" });
    expect(r.status).toBe(201);
    expect(crearPedido).toHaveBeenCalledTimes(1);

    const [, datos, , plan] = crearPedido.mock.calls[0];
    expect(datos.pagoMetodo).toBe("a_coordinar");
    // Sin plan de cuotas: cuotas_max y cuotas_plan quedan en null. La oferta ni
    // se consulta (no es un pedido de Mercado Pago).
    expect(plan).toBeNull();
    expect(getOferta).not.toHaveBeenCalled();
    // Proveedor y referencia del cobro no viajan: los escribe recién el cobro.
    expect(datos).not.toHaveProperty("pagoProveedor");
    expect(datos).not.toHaveProperty("pagoReferencia");
    expect((await r.json()).cuotasMax).toBeNull();
  });

  it("acepta a_coordinar también con envío", async () => {
    const r = await post({
      pagoMetodo: "a_coordinar",
      entregaTipo: "envio",
      entregaCiudad: "Puerto Iguazú",
      entregaDireccion: "Calle 1",
    });
    expect(r.status).toBe(201);
  });

  it("el body no puede colar datos de cobro", async () => {
    await post({
      pagoMetodo: "a_coordinar",
      pagoProveedor: "mercadopago",
      pagoReferencia: "123",
      pagoEstado: "pagado",
      cuotasMax: 12,
    });
    const [, datos, , plan] = crearPedido.mock.calls[0];
    expect(datos).not.toHaveProperty("pagoProveedor");
    expect(datos).not.toHaveProperty("pagoReferencia");
    expect(datos).not.toHaveProperty("pagoEstado");
    expect(plan).toBeNull();
  });
});

describe("POST /api/pedidos — pagos prendidos", () => {
  beforeEach(() => {
    pagos = true;
  });

  it("rechaza a_coordinar", async () => {
    const r = await post({ pagoMetodo: "a_coordinar" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("sigue aceptando los métodos de siempre", async () => {
    getOferta.mockResolvedValue(null);
    for (const pagoMetodo of ["transferencia", "mercadopago", "efectivo"]) {
      crearPedido.mockClear();
      const r = await post({ pagoMetodo });
      expect(r.status, pagoMetodo).toBe(201);
      expect(crearPedido.mock.calls[0][1].pagoMetodo).toBe(pagoMetodo);
    }
  });

  it("efectivo sigue sin valer para envío", async () => {
    const r = await post({
      pagoMetodo: "efectivo",
      entregaTipo: "envio",
      entregaCiudad: "Puerto Iguazú",
      entregaDireccion: "Calle 1",
    });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/pedidos — método basura, con cualquier valor del flag", () => {
  it.each([true, false])("pagos=%s: faltante, vacío o inventado → 400", async (valor) => {
    pagos = valor;
    for (const extra of [{}, { pagoMetodo: "" }, { pagoMetodo: "xyz" }, { pagoMetodo: 7 }]) {
      const r = await post(extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    }
    expect(crearPedido).not.toHaveBeenCalled();
  });
});
