import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";

/**
 * Con qué cuenta cobra `cobrarPedido`: la de la sucursal del pedido (`facturaSucursal ?? sucursal ??
 * predeterminada`), con el proveedor REAL de Mercado Pago ligado a esa cuenta (sólo `fetch` simulado).
 * Fallback a la otra cuenta del mismo procesador SÓLO si la prevista no está configurada o el procesador
 * rechazó sus credenciales (401/403); nunca por un rechazo del pago, un 4xx de datos, un 5xx o la red.
 */

const reservarIntento = vi.fn(async (..._a: unknown[]) => ({ intentoId: "i1" }) as unknown);
const getPedidoParaPago = vi.fn();
const registrarCobro = vi.fn(async () => true);
/**
 * Evidencia de credenciales rechazadas, como en la base: `cerrarIntentoSinPago` con
 * `credenciales_rechazadas:<cuenta>` la escribe y `cuentasRechazadasDelPedido` la lee.
 */
const evidencia = vi.hoisted(() => [] as string[]);
const cerrarIntentoSinPago = vi.fn(async (_id: string, detalle: string) => {
  if (detalle.startsWith("credenciales_rechazadas:")) evidencia.push(detalle.split(":")[1]);
});

vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => [{ slug: "mercadopago" }] }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  cuentasRechazadasDelPedido: async () => [...evidencia],
  detalleCredencialesRechazadas: (c: string) => `credenciales_rechazadas:${c}`,
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: (...a: unknown[]) => reservarIntento(...a),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  getItemsParaAntifraude: vi.fn(),
  registrarCobro: (...a: unknown[]) => registrarCobro(...(a as [])),
  registrarIntentoFallido: vi.fn(async () => {}),
  fijarReferenciaIntento: vi.fn(),
  cerrarIntentoSinPago: (...a: [string, string]) => cerrarIntentoSinPago(...a),
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
  cerrarIntentoSinPago.mockClear();
  evidencia.length = 0;
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

  it("la cuenta prevista sin credenciales: cobra con la otra configurada y congela las dos en el intento", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    const r = await pagar();
    expect(r.status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-igz"]);
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", expect.anything(), {
      cuenta: "igz",
      cuentaPrevista: "mdp",
    });
  });

  it("sin fallback: el intento congela la prevista como cuenta y prevista", async () => {
    await pagar();
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", expect.anything(), {
      cuenta: "mdp",
      cuentaPrevista: "mdp",
    });
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

  it.each([400, 402, 404, 422, 500, 502, 504])("un error %i del procesador no prueba otra cuenta", async (status) => {
    responder(status, { message: "error" });
    const r = await pagar();
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.motivo).not.toBe("cuenta_rechazada");
    expect(j.config).toBeUndefined();
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
    expect(evidencia).toEqual([]);
  });

  it("sin respuesta (red / timeout) no prueba otra cuenta y la reserva queda abierta", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await pagar();
    expect(r.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cerrarIntentoSinPago).not.toHaveBeenCalled();
  });
});

describe("cobrarPedido — credenciales rechazadas (401/403)", () => {
  it.each([401, 403])("%i: cierra el intento con la evidencia y responde 409 cuenta_rechazada con la config de la otra", async (status) => {
    responder(status, { message: "invalid access token" });
    const r = await pagar();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "Hubo un inconveniente con el procesador de pagos. Vuelva a ingresar los datos de su tarjeta.",
      motivo: "cuenta_rechazada",
      reintentable: true,
      config: { cuenta: "igz", publicKey: "TEST-publica-igz" },
    });
    // Una sola llamada, con la cuenta del pedido: el token de la tarjeta es de esa cuenta.
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
    expect(cerrarIntentoSinPago).toHaveBeenCalledWith("i1", "credenciales_rechazadas:mdp");
  });

  it("el reintento del mismo pedido (otra instancia: evidencia en la base) cobra con la otra cuenta", async () => {
    evidencia.push("mdp");
    responder(201, { id: 10, status: "approved", status_detail: "accredited", external_reference: "p1" });
    const r = await pagar({ cuenta: "igz" });
    expect(r.status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-igz"]);
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", expect.anything(), {
      cuenta: "igz",
      cuentaPrevista: "mdp",
    });
  });

  it("un bundle viejo sin `cuenta` en el reintento: la que resuelve el servidor (la otra)", async () => {
    evidencia.push("mdp");
    expect((await pagar()).status).toBe(200);
    expect(autorizaciones()).toEqual(["Bearer TEST-token-igz"]);
  });

  it("un pedido nuevo (sin evidencia) vuelve a intentar PRIMERO la prevista", async () => {
    responder(401, { message: "invalid access token" });
    await pagar();
    evidencia.length = 0;
    fetchMock.mockClear();
    responder(201, { id: 11, status: "approved", status_detail: "accredited", external_reference: "p1" });
    await pagar();
    expect(autorizaciones()).toEqual(["Bearer TEST-token-mdp"]);
  });

  it("401 sin otra cuenta configurada: 502 con el mensaje de inconveniente técnico", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    responder(401, { message: "invalid access token" });
    const r = await pagar();
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({
      error:
        "No pudimos procesar el pago por un inconveniente técnico. Inténtelo nuevamente en unos minutos o elija otro medio de pago.",
      motivo: "cuentas_rechazadas",
    });
  });

  it("las dos cuentas rechazan: 502 y no vuelve a llamar al procesador", async () => {
    evidencia.push("mdp", "igz");
    const r = await pagar();
    expect(r.status).toBe(502);
    expect((await r.json()).motivo).toBe("cuentas_rechazadas");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reservarIntento).not.toHaveBeenCalled();
  });

  it("tras un rechazo de credenciales, declarar la cuenta vieja es cuenta_no_valida con la config de la otra", async () => {
    evidencia.push("mdp");
    const r = await pagar({ cuenta: "mdp" });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("cuenta_no_valida");
    expect(j.config).toEqual({ cuenta: "igz", publicKey: "TEST-publica-igz" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
