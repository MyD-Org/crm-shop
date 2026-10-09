import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** La reconciliación mira cada proveedor registrado y omite uno desconocido sin romper el lote. */

const consultarPago = vi.fn();
const intentosPendientesDeReconciliar = vi.fn();
const registrarCobro = vi.fn();

vi.mock("./mercadopago", async (orig) => ({
  ...(await orig<typeof import("./mercadopago")>()),
  // Proveedor ligado a la cuenta del pedido: un doble que recuerda su cuenta.
  crearMercadoPago: (cuenta: string) => ({
    id: "mercadopago",
    cuenta,
    configurado: () => cuenta !== "sin-credenciales",
    consultarPago: (...a: unknown[]) => consultarPago(cuenta, ...a),
  }),
}));
vi.mock("@/lib/pedidos", () => ({
  intentosPendientesDeReconciliar: (...a: unknown[]) => intentosPendientesDeReconciliar(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
}));

import { reconciliarPagosPendientes } from "./reconciliar";

beforeEach(() => {
  for (const f of [consultarPago, intentosPendientesDeReconciliar, registrarCobro]) f.mockReset();
  intentosPendientesDeReconciliar.mockResolvedValue([]);
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reconciliarPagosPendientes — por proveedor", () => {
  it("un proveedor desconocido se omite: no consulta la base ni falla", async () => {
    const r = await reconciliarPagosPendientes({ proveedor: "desconocido" });
    expect(r).toEqual({ revisados: 0, actualizados: 0, errores: 0 });
    expect(intentosPendientesDeReconciliar).not.toHaveBeenCalled();
  });

  it("sin indicar proveedor recorre todos los registrados", async () => {
    await reconciliarPagosPendientes();
    expect(intentosPendientesDeReconciliar.mock.calls.map((c) => c[0].proveedor)).toEqual(["mercadopago"]);
  });

  it("consulta a cada intento con el proveedor que lo creó", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([{ orderId: "p1", referencia: "r1", sucursal: "igz", facturaSucursal: null }]);
    consultarPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
    registrarCobro.mockResolvedValue(true);
    await reconciliarPagosPendientes({ proveedor: "mercadopago" });
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ proveedor: "mercadopago" }));
  });

  it("cada intento se consulta con la cuenta de SU pedido (la que factura si la zona la fuerza)", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([
      { orderId: "p1", referencia: "r1", sucursal: "mdp", facturaSucursal: null },
      { orderId: "p2", referencia: "r2", sucursal: "mdp", facturaSucursal: "igz" },
    ]);
    consultarPago.mockResolvedValue({ estado: "pendiente", referencia: "r", detalle: "x" });
    await reconciliarPagosPendientes({ proveedor: "mercadopago" });
    expect(consultarPago.mock.calls).toEqual([
      ["mdp", "r1"],
      ["igz", "r2"],
    ]);
  });

  it("una cuenta sin credenciales: sus intentos cuentan como error, un solo log, y el lote sigue", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    intentosPendientesDeReconciliar.mockResolvedValue([
      { orderId: "p1", referencia: "r1", sucursal: "sin-credenciales", facturaSucursal: null },
      { orderId: "p2", referencia: "r2", sucursal: "sin-credenciales", facturaSucursal: null },
      { orderId: "p3", referencia: "r3", sucursal: "igz", facturaSucursal: null },
    ]);
    consultarPago.mockResolvedValue({ estado: "pagado", referencia: "r3", detalle: "ok" });
    registrarCobro.mockResolvedValue(true);
    const r = await reconciliarPagosPendientes({ proveedor: "mercadopago" });
    expect(r).toEqual({ revisados: 3, actualizados: 1, errores: 2 });
    expect(consultarPago.mock.calls).toEqual([["igz", "r3"]]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("sin-credenciales");
  });

  it("sin ninguna cuenta configurada del procesador no consulta la base", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    await reconciliarPagosPendientes({ proveedor: "mercadopago" });
    expect(intentosPendientesDeReconciliar).not.toHaveBeenCalled();
  });
});
