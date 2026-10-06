import { beforeEach, describe, expect, it, vi } from "vitest";

/** La reconciliación mira cada proveedor registrado y omite uno desconocido sin romper el lote. */

const consultarPago = vi.fn();
const intentosPendientesDeReconciliar = vi.fn();
const registrarCobro = vi.fn();

vi.mock("./mercadopago", () => ({
  mercadoPago: { id: "mercadopago", configurado: () => true, consultarPago: (...a: unknown[]) => consultarPago(...a) },
}));
vi.mock("@/lib/pedidos", () => ({
  intentosPendientesDeReconciliar: (...a: unknown[]) => intentosPendientesDeReconciliar(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
}));

import { reconciliarPagosPendientes } from "./reconciliar";

beforeEach(() => {
  for (const f of [consultarPago, intentosPendientesDeReconciliar, registrarCobro]) f.mockReset();
  intentosPendientesDeReconciliar.mockResolvedValue([]);
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
    intentosPendientesDeReconciliar.mockResolvedValue([{ orderId: "p1", referencia: "r1" }]);
    consultarPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
    registrarCobro.mockResolvedValue(true);
    await reconciliarPagosPendientes({ proveedor: "mercadopago" });
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ proveedor: "mercadopago" }));
  });
});
