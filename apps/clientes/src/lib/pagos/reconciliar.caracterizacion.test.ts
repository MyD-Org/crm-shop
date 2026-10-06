import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CARACTERIZACIÓN de la reconciliación con Mercado Pago (rebanada A de payway-cobro): por defecto
 * mira el proveedor mercadopago, consulta cada intento y registra el cobro; un error no frena el lote.
 */

const consultarPago = vi.fn();
const intentosPendientesDeReconciliar = vi.fn();
const registrarCobro = vi.fn();

vi.mock("./mercadopago", () => ({
  mercadoPago: { id: "mercadopago", consultarPago: (...a: unknown[]) => consultarPago(...a) },
}));
vi.mock("@/lib/pedidos", () => ({
  intentosPendientesDeReconciliar: (...a: unknown[]) => intentosPendientesDeReconciliar(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
}));

import { reconciliarPagosPendientes } from "./reconciliar";

beforeEach(() => {
  for (const f of [consultarPago, intentosPendientesDeReconciliar, registrarCobro]) f.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reconciliarPagosPendientes — caracterización", () => {
  it("pide los pendientes de mercadopago con la ventana y el límite de siempre", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([]);
    const antes = Date.now();
    await reconciliarPagosPendientes();
    const arg = intentosPendientesDeReconciliar.mock.calls[0][0];
    expect(arg.proveedor).toBe("mercadopago");
    expect(arg.limite).toBe(100);
    expect(antes - arg.quietosDesde.getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 50);
    expect(antes - arg.creadosDesde.getTime()).toBeGreaterThanOrEqual(3 * 24 * 60 * 60_000 - 50);
  });

  it("consulta cada intento y registra el cobro con lo que informa el proveedor", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([
      { orderId: "p1", referencia: "r1" },
      { orderId: "p2", referencia: "r2" },
    ]);
    consultarPago.mockResolvedValue({
      estado: "pagado",
      referencia: "r1",
      detalle: "accredited",
      cuotasPagadas: 2,
      totalPagado: 50,
      reversion: false,
    });
    registrarCobro.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const r = await reconciliarPagosPendientes({ limite: 7 });
    expect(r).toEqual({ revisados: 2, actualizados: 1, errores: 0 });
    expect(intentosPendientesDeReconciliar.mock.calls[0][0].limite).toBe(7);
    expect(consultarPago).toHaveBeenNthCalledWith(1, "r1");
    expect(registrarCobro).toHaveBeenNthCalledWith(1, "p1", {
      proveedor: "mercadopago",
      referencia: "r1",
      estado: "pagado",
      detalle: "accredited",
      reversion: false,
      cuotas: 2,
      totalPagado: 50,
    });
  });

  it("un error en un intento se cuenta y el lote sigue", async () => {
    intentosPendientesDeReconciliar.mockResolvedValue([
      { orderId: "p1", referencia: "r1" },
      { orderId: "p2", referencia: "r2" },
    ]);
    consultarPago
      .mockRejectedValueOnce(new Error("MP caído"))
      .mockResolvedValueOnce({ estado: "pagado", referencia: "r2", detalle: "x" });
    registrarCobro.mockResolvedValue(true);
    const r = await reconciliarPagosPendientes();
    expect(r).toEqual({ revisados: 2, actualizados: 1, errores: 1 });
  });
});
