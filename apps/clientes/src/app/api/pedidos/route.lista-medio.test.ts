import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Precio por medio de pago en POST /api/pedidos: el servidor recotiza con la lista del medio
 * elegido (resuelta desde el slug validado), compara con `totalVisto` y guarda la lista usada.
 * Con lista privada del comprador el medio no pone precio (ver route.lista-privada.test.ts).
 */
const crearPedido = vi.fn();
const cotizar = vi.fn();
let totalCotizado = 200000;

vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
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
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/contacto-pedido-repo", () => ({ contactoDelPedido: async () => null }));

let medios: unknown[] = [];
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));

import { POST } from "./route";

const medio = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...extra,
});

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

const opcionesCotizar = () => cotizar.mock.calls[0][1] as { idListaMedio?: string; idPriceList?: string };

beforeEach(() => {
  totalCotizado = 200000;
  medios = [medio("transferencia", { idListaPrecios: "9" }), medio("efectivo")];
  cotizar.mockReset();
  cotizar.mockImplementation(async () => ({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal: totalCotizado / 1.21,
    iva: totalCotizado - totalCotizado / 1.21,
    costoEnvio: 0,
    total: totalCotizado,
  }));
  crearPedido.mockReset();
  crearPedido.mockImplementation(async () => ({ id: "p1", numero: "PED-1", repetido: false, cuotas: null }));
});

describe("POST /api/pedidos — lista del medio de pago", () => {
  it("recotiza con la lista del medio y guarda esa lista en el pedido", async () => {
    expect((await post()).status).toBe(201);
    expect(opcionesCotizar().idListaMedio).toBe("9");
    expect(crearPedido.mock.calls[0][0].idPriceList).toBe("9");
  });

  it("medio sin lista: cotiza con la lista por defecto y no guarda lista", async () => {
    expect((await post({ pagoMetodo: "efectivo" })).status).toBe(201);
    expect(opcionesCotizar().idListaMedio).toBeUndefined();
    expect(crearPedido.mock.calls[0][0].idPriceList).toBeUndefined();
  });

  it("ignora cualquier lista o precio que venga en el body", async () => {
    await post({ idListaMedio: "98", idPriceList: "99", precio: 1 });
    expect(opcionesCotizar().idListaMedio).toBe("9");
  });

  it("totalVisto distinto del total del medio: 409 en usted y no crea el pedido", async () => {
    const r = await post({ totalVisto: 250000 });
    expect(r.status).toBe(409);
    const json = await r.json();
    expect(json.motivo).toBe("precio_cambio");
    expect(json.totalNuevo).toBe(200000);
    expect(json.error).toContain("Revise");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("totalVisto igual al total del medio: crea el pedido", async () => {
    expect((await post({ totalVisto: 200000 })).status).toBe(201);
    expect(crearPedido).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/pedidos — forma de pago (listas por forma)", () => {
  beforeEach(() => {
    medios = [
      medio("mercadopago", { cobroOnline: true, idListaPrecios: "9", listasPorForma: { debito: "7" } }),
      medio("payway", { cobroOnline: true, idListaPrecios: "9", listasPorForma: { debito: "7" } }),
      medio("transferencia", { idListaPrecios: "9" }),
    ];
  });

  it("débito: cotiza con la lista de débito, la guarda y congela la forma", async () => {
    expect((await post({ pagoMetodo: "mercadopago", forma: "debito" })).status).toBe(201);
    expect(opcionesCotizar().idListaMedio).toBe("7");
    expect(crearPedido.mock.calls[0][0].idPriceList).toBe("7");
    expect(crearPedido.mock.calls[0][1].formaCobro).toBe("debito");
  });

  it("sin forma en el body: nace con crédito y la lista del medio", async () => {
    await post({ pagoMetodo: "mercadopago" });
    expect(opcionesCotizar().idListaMedio).toBe("9");
    expect(crearPedido.mock.calls[0][1].formaCobro).toBe("credito");
  });

  it("forma no disponible: 400 en usted y no crea el pedido", async () => {
    const r = await post({ pagoMetodo: "payway", forma: "cuenta_mp" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Esa forma de pago no está disponible para este medio.");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("medio sin cobro en línea: ignora la forma (forma_cobro null)", async () => {
    await post({ pagoMetodo: "transferencia", forma: "debito" });
    expect(crearPedido.mock.calls[0][1].formaCobro).toBeNull();
  });
});
