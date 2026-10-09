import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";

const crearPreferencia = vi.fn();
const registrarCuentaRechazada = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
let pedido: PedidoParaPago | null;
let sesion = true;

// Formas de pago del medio (migración 0073 del CRM): sin dato = todas las de su procesador.
let medios: { slug: string; opcionesCobro?: string[] }[] = [];
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () =>
    sesion ? { clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" } : { clerkUserId: null, cliente: null },
}));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  cuentasRechazadasDelPedido: async () => [],
  registrarCuentaRechazada: (...a: unknown[]) => registrarCuentaRechazada(...a),
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  VENTANA_PAGO_MS: (await original<typeof import("@/lib/pedidos")>()).VENTANA_PAGO_MS,
  getPedidoParaPago: async () => pedido,
}));
// Sucursales del CRM: igz (predeterminada) y mdp.
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          { slug: "igz", activa: true, predeterminada: true },
          { slug: "mdp", activa: true, predeterminada: false },
        ],
      }),
    }),
  }),
}));
vi.mock("@/lib/pagos/mercadopago", async (original) => ({
  ...(await original<typeof import("@/lib/pagos/mercadopago")>()),
  crearPreferencia: (...a: unknown[]) => crearPreferencia(...a),
}));

import { POST } from "./route";
import { limpiarMemoCuentas } from "@/lib/pagos/cuentas-sucursales";
import { ErrorProveedor } from "@/lib/pagos/tipos";

const pedir = (body: unknown = { pedidoId: "p1" }) =>
  POST(
    new Request("https://tienda.example/api/pagos/mercadopago/preferencia", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  limpiarMemoCuentas();
  registrarCuentaRechazada.mockClear();
  medios = [{ slug: "mercadopago" }];
  sesion = true;
  // Cuentas de Mercado Pago de dos sucursales; el pedido es de mdp.
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
  vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-publica-mdp");
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-publica-igz");
  crearPreferencia.mockReset().mockResolvedValue("https://mp.example/checkout/pref-123");
  pedido = {
    id: "p1", numero: "000001", total: 120000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
    clienteEmail: "ana@cliente.example", facturacionTipoDoc: null, facturacionNroDoc: null,
    cuotas: null, estado: "pendiente", creadoEn: new Date(), sucursal: "mdp", facturaSucursal: null,
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/pagos/mercadopago/preferencia", () => {
  it("crea la preferencia desde el pedido congelado y devuelve sólo el link de pago", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://mp.example/checkout/pref-123" });
    // Con la cuenta del pedido; la URL del aviso lleva la cuenta como pista.
    expect(crearPreferencia.mock.calls[0][0]).toBe("mdp");
    const pref = crearPreferencia.mock.calls[0][1];
    expect(pref.notification_url).toContain("cuenta=mdp");
    expect(pref.items[0].unit_price).toBe(120000);
    expect(pref.external_reference).toBe("p1");
    expect(pref.purpose).toBe("wallet_purchase");
    expect(pref.payment_methods).toEqual({ installments: 1, excluded_payment_methods: [{ id: "consumer_credits" }] });
    expect(pref.back_urls.success).toBe("https://tienda.example/checkout?pedido=p1&pago=mp");
  });

  it("el monto no se toma del body", async () => {
    await pedir({ pedidoId: "p1", total: 1, monto: 1 });
    expect(crearPreferencia.mock.calls[0][1].items[0].unit_price).toBe(120000);
  });

  it("un pago (cuotas 1) también la ofrece", async () => {
    pedido!.cuotas = 1;
    expect((await pedir()).status).toBe(200);
  });

  it("con cuotas congeladas: la ofrece con ese tope de cuotas", async () => {
    pedido!.cuotas = 3;
    expect((await pedir()).status).toBe(200);
    expect(crearPreferencia.mock.calls[0][1].payment_methods.installments).toBe(3);
  });

  it("sin sesión: 401", async () => {
    sesion = false;
    expect((await pedir()).status).toBe(401);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("sin credenciales de Mercado Pago en ninguna cuenta: 409", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    expect((await pedir()).status).toBe(409);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("la cuenta del pedido sin credenciales: la preferencia se crea con la otra cuenta configurada", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(crearPreferencia.mock.calls.map((c) => c[0])).toEqual(["igz"]);
  });

  it.each([401, 403])("credenciales rechazadas (%i): prueba la otra cuenta en el mismo request y deja la evidencia", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    crearPreferencia.mockImplementation(async (cuenta: string) => {
      if (cuenta === "mdp") throw new ErrorProveedor(`Mercado Pago respondió ${status}`, status);
      return "https://mp.example/checkout/pref-igz";
    });
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://mp.example/checkout/pref-igz" });
    expect(crearPreferencia.mock.calls.map((c) => c[0])).toEqual(["mdp", "igz"]);
    expect(crearPreferencia.mock.calls[1][1].notification_url).toContain("cuenta=igz");
    expect(registrarCuentaRechazada).toHaveBeenCalledWith("p1", "mercadopago", "mdp", "mdp", "servidor");
  });

  it.each([400, 500, 502])("otro error (%i): no prueba otra cuenta", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crearPreferencia.mockRejectedValue(new ErrorProveedor(`Mercado Pago respondió ${status}`, status));
    expect((await pedir()).status).toBe(502);
    expect(crearPreferencia).toHaveBeenCalledTimes(1);
    expect(registrarCuentaRechazada).not.toHaveBeenCalled();
  });

  it("las dos cuentas rechazan sus credenciales: 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crearPreferencia.mockRejectedValue(new ErrorProveedor("Mercado Pago respondió 401", 401));
    expect((await pedir()).status).toBe(502);
    expect(crearPreferencia.mock.calls.map((c) => c[0])).toEqual(["mdp", "igz"]);
  });

  it("pedido de igz: la preferencia se crea con la cuenta de igz", async () => {
    pedido!.sucursal = "igz";
    expect((await pedir()).status).toBe(200);
    expect(crearPreferencia.mock.calls[0][0]).toBe("igz");
  });

  it("pedido ajeno o inexistente: 404", async () => {
    pedido = null;
    expect((await pedir()).status).toBe(404);
  });

  it("pedido de otro medio de pago: 404", async () => {
    pedido!.pagoMetodo = "transferencia";
    expect((await pedir()).status).toBe(404);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("pedido ya pagado: 409", async () => {
    pedido!.pagoEstado = "pagado";
    expect((await pedir()).status).toBe(409);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("pedido cancelado: 409", async () => {
    pedido!.estado = "cancelado";
    expect((await pedir()).status).toBe(409);
  });

  it("falla de Mercado Pago: 502 sin filtrar el detalle", async () => {
    crearPreferencia.mockRejectedValue(new Error("secreto interno"));
    const res = await pedir();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secreto");
  });

  it("sin pedidoId: 400", async () => {
    expect((await pedir({})).status).toBe(400);
  });
});

describe("POST /api/pagos/mercadopago/preferencia — forma de pago (migración 0073 del CRM)", () => {
  it("cuenta de Mercado Pago deshabilitada en el medio: 422 en usted, sin crear la preferencia", async () => {
    medios = [{ slug: "mercadopago", opcionesCobro: ["credito", "debito"] }];
    const res = await pedir();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ motivo: "opcion_no_habilitada" });
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("medio que no se puede leer: 502 sin crear la preferencia", async () => {
    medios = [];
    expect((await pedir()).status).toBe(502);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });
});
