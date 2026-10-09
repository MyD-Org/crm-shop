import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";

/**
 * Con qué cuenta cobra `cobrarPedido`: la de la sucursal del pedido (`facturaSucursal ?? sucursal ??
 * predeterminada`), con el proveedor REAL de Mercado Pago ligado a esa cuenta (sólo `fetch` simulado).
 * En esta rebanada no hay fallback: sin credenciales de la cuenta prevista, el medio falla cerrado.
 */

const reservarIntento = vi.fn(async (..._a: unknown[]) => ({ intentoId: "i1" }) as unknown);
const getPedidoParaPago = vi.fn();
const registrarCobro = vi.fn(async () => true);

vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => [{ slug: "mercadopago" }] }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: (...a: unknown[]) => reservarIntento(...a),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  getItemsParaAntifraude: vi.fn(),
  registrarCobro: (...a: unknown[]) => registrarCobro(...(a as [])),
  registrarIntentoFallido: vi.fn(async () => {}),
  fijarReferenciaIntento: vi.fn(),
  cerrarIntentoSinPago: vi.fn(),
}));
vi.mock("./intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));
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

import { cobrarPedido } from "./cobrar";
import { limpiarMemoCuentas } from "./cuentas-sucursales";

const fetchMock = vi.fn();

const pedido = (sucursal: string | null, facturaSucursal: string | null = null): PedidoParaPago => ({
  id: "p1", numero: "PED-1", total: 1000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
  clienteEmail: "a@cliente.example", facturacionTipoDoc: null, facturacionNroDoc: null,
  cuotas: 1, estado: "pendiente", creadoEn: new Date(), sucursal, facturaSucursal,
});

const pagar = (body: Record<string, unknown> = {}) =>
  cobrarPedido(
    "mercadopago",
    new Request("https://tienda.example/api/pagos/mercadopago", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", cuotas: 1, metodoPagoId: "visa", ...body }),
    }),
  );

const autorizaciones = () =>
  (fetchMock.mock.calls as [string, RequestInit][]).map(([, init]) => (init.headers as Record<string, string>).Authorization);

const responder = (status: number, cuerpo: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(cuerpo), { status }));

beforeEach(() => {
  limpiarMemoCuentas();
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-publica-igz");
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
  vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-publica-mdp");
  vi.stubGlobal("fetch", fetchMock);
  responder(201, { id: 9, status: "approved", status_detail: "accredited", external_reference: "p1" });
  getPedidoParaPago.mockResolvedValue(pedido("mdp"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  reservarIntento.mockClear();
  getPedidoParaPago.mockReset();
});

describe("cobrarPedido — cuenta del pedido", () => {
  it.each([
    ["sucursal mdp", pedido("mdp"), "TEST-token-mdp"],
    ["sucursal igz", pedido("igz"), "TEST-token-igz"],
    ["la zona fuerza la cuenta que factura (despacha igz, factura mdp)", pedido("igz", "mdp"), "TEST-token-mdp"],
    ["sin sucursal: la predeterminada", pedido(null), "TEST-token-igz"],
  ])("%s: cobra con las credenciales de esa cuenta y de ninguna otra", async (_n, p, token) => {
    getPedidoParaPago.mockResolvedValue(p);
    const r = await pagar();
    expect(r.status).toBe(200);
    expect((await r.json()).estado).toBe("pagado");
    expect(autorizaciones()).toEqual([`Bearer ${token}`]);
  });

  it("la URL del aviso lleva la cuenta como pista", async () => {
    await pagar();
    const cuerpo = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(cuerpo.notification_url).toContain("cuenta=mdp");
  });

  it("la cuenta prevista sin credenciales: 409 sin reservar ni llamar al procesador (sin cobrar con otra)", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    const r = await pagar();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toMatchObject({ motivo: "mp_no_configurado" });
    expect(j.error).toBe("Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reservarIntento).not.toHaveBeenCalled();
  });

  it("sin NINGUNA cuenta configurada: 409 en usted, antes de leer el pedido", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    const r = await pagar();
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe(
      "El medio de pago no está disponible por el momento. Seleccione otro medio de pago o inténtelo nuevamente más tarde.",
    );
    expect(getPedidoParaPago).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("las variables sin sufijo no cuentan como cuenta configurada", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token-viejo");
    expect((await pagar()).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("la cuenta que declara el navegador coincide: cobra", async () => {
    expect((await pagar({ cuenta: "mdp" })).status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
  });

  it("la cuenta que declara el navegador NO es la del pedido: 409 cuenta_no_valida con la config vigente, sin cobrar", async () => {
    const r = await pagar({ cuenta: "igz" });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("cuenta_no_valida");
    expect(j.config).toEqual({ cuenta: "mdp", publicKey: "TEST-publica-mdp" });
    expect(j.error).toMatch(/Vuelva a ingresar/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reservarIntento).not.toHaveBeenCalled();
  });

  it("un rechazo del pago no cambia de cuenta: una sola llamada, con la cuenta del pedido", async () => {
    responder(201, { id: 9, status: "rejected", status_detail: "cc_rejected_insufficient_amount" });
    const r = await pagar();
    expect((await r.json()).estado).toBe("fallido");
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
  });

  it.each([401, 500])("un error %i del procesador no prueba otra cuenta", async (status) => {
    responder(status, { message: "error" });
    const r = await pagar();
    expect(r.status).toBe(502);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
  });
});
