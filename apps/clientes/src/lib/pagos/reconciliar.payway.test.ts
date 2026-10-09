import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import listadoUnPago from "./__fixtures__/payway/listado-un-pago.json";
import listadoVacio from "./__fixtures__/payway/listado-vacio.json";
import rechazado51 from "./__fixtures__/payway/pago-rechazado-51.json";
import { NO_LLEGO_MS } from "./intento-abierto";

/**
 * La conciliación con Payway (sin webhooks, es la única red de seguridad): consulta cada intento
 * pendiente por su site_transaction_id con el adaptador REAL y un fetch simulado.
 */

const intentosPendientesDeReconciliar = vi.fn();
const registrarCobro = vi.fn();

// Sin cuentas de Mercado Pago en el entorno: sólo Payway.
vi.mock("@/lib/pedidos", () => ({
  intentosPendientesDeReconciliar: (...a: unknown[]) => intentosPendientesDeReconciliar(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
}));

import { reconciliarPagosPendientes } from "./reconciliar";

const REF = "0123456789abcdef0123456789abcdef";
const fetchMock = vi.fn();
const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

const candidato = (minutos: number, sucursal = "mdp") => ({
  orderId: "p1",
  referencia: REF,
  creadoEn: new Date(Date.now() - minutos * 60_000),
  sucursal,
  facturaSucursal: null,
});

beforeEach(() => {
  for (const f of [fetchMock, intentosPendientesDeReconciliar, registrarCobro]) f.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY_MDP", "clave-privada-de-prueba");
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY_MDP", "clave-publica-de-prueba");
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY_IGZ", "clave-privada-de-otra-cuenta");
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY_IGZ", "clave-publica-de-otra-cuenta");
  vi.stubEnv("PAYWAY_BASE_URL", "https://payway.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
  registrarCobro.mockResolvedValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const correr = () => reconciliarPagosPendientes({ proveedor: "payway" });

describe("reconciliarPagosPendientes — payway", () => {
  it("consulta por site_transaction_id y registra approved como pagado", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([candidato(30)]);
    fetchMock.mockImplementation(async () => json(200, listadoUnPago));
    const r = await correr();
    expect(r).toEqual({ revisados: 1, actualizados: 1, errores: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://payway.example/api/v2/payments?siteOperationId=${REF}`);
    expect(registrarCobro).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ proveedor: "payway", referencia: REF, estado: "pagado" }),
    );
  });

  it("registra rejected como fallido", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([candidato(30)]);
    fetchMock.mockImplementation(async () => json(200, { ...listadoVacio, results: [rechazado51] }));
    await correr();
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ estado: "fallido" }));
  });

  it("pago que Payway no conoce y el intento es reciente: sigue pendiente", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([candidato(NO_LLEGO_MS / 60_000 - 5)]);
    fetchMock.mockImplementation(async () => json(200, listadoVacio));
    await correr();
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ estado: "pendiente" }));
  });

  it("pago que Payway no conoce y el intento ya es viejo: no llegó (fallido)", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([candidato(NO_LLEGO_MS / 60_000 + 5)]);
    fetchMock.mockImplementation(async () => json(200, listadoVacio));
    await correr();
    expect(registrarCobro).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ estado: "fallido", detalle: "no_llego" }),
    );
  });

  it("si Payway no responde cuenta un error y sigue con el siguiente", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([candidato(30), { ...candidato(30), orderId: "p2" }]);
    fetchMock
      .mockImplementationOnce(async () => json(503, {}))
      .mockImplementation(async () => json(200, listadoUnPago));
    const r = await correr();
    expect(r).toEqual({ revisados: 2, actualizados: 1, errores: 1 });
    expect(registrarCobro).toHaveBeenCalledTimes(1);
  });

  it("consulta con la key privada de la cuenta del pedido (un 504 de mdp se concilia con mdp, no con igz)", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([candidato(30, "mdp"), { ...candidato(30, "igz"), orderId: "p2" }]);
    fetchMock.mockImplementation(async () => json(200, listadoUnPago));
    await correr();
    const claves = (fetchMock.mock.calls as [string, RequestInit][]).map(([, i]) => (i.headers as Record<string, string>).apikey);
    expect(claves).toEqual(["clave-privada-de-prueba", "clave-privada-de-otra-cuenta"]);
  });

  it("sin credenciales de Payway en ninguna cuenta se omite: no consulta la base ni la red", async () => {
    vi.stubEnv("PAYWAY_API_PRIVATE_KEY_MDP", "");
    vi.stubEnv("PAYWAY_API_PRIVATE_KEY_IGZ", "");
    const r = await correr();
    expect(r).toEqual({ revisados: 0, actualizados: 0, errores: 0 });
    expect(intentosPendientesDeReconciliar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
