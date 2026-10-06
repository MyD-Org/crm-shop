import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProveedorPago } from "./tipos";

/**
 * La consulta del comprador y la conciliación pasan por el mismo camino: `registrarCobro` SIN
 * `avisar: false`, que es el que dispara `pago_recibido` / `pago_rechazado` al cambiar el estado del
 * pedido (ver `avisoDelCobro`). Un intento que el procesador no conoce y es viejo se da por "no llegó".
 */

const registrarCobro = vi.fn();
vi.mock("@/lib/pedidos", () => ({ registrarCobro: (...a: unknown[]) => registrarCobro(...a) }));

import { conciliarIntento } from "./conciliar-intento";
import { NO_LLEGO_MS } from "./intento-abierto";

const consultarPago = vi.fn();
const proveedor = { id: "payway", consultarPago: (...a: unknown[]) => consultarPago(...a) } as unknown as ProveedorPago;

beforeEach(() => {
  vi.clearAllMocks();
  registrarCobro.mockResolvedValue(true);
});

describe("conciliarIntento", () => {
  it("registra lo que dice el procesador y deja que el aviso salga (sin avisar:false)", async () => {
    consultarPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "approved", cuotasPagadas: 3, totalPagado: 1500 });
    const r = await conciliarIntento(proveedor, { orderId: "p1", referencia: "r1", creadoEn: new Date() });
    expect(r.cambio).toBe(true);
    expect(registrarCobro).toHaveBeenCalledTimes(1);
    const [id, cobro, opciones] = registrarCobro.mock.calls[0];
    expect(id).toBe("p1");
    expect(cobro).toMatchObject({ proveedor: "payway", referencia: "r1", estado: "pagado", cuotas: 3, totalPagado: 1500 });
    expect(opciones).toBeUndefined();
  });

  it("un pago que el procesador no conoce y es viejo se registra como fallido (no llegó)", async () => {
    consultarPago.mockResolvedValue({ estado: "pendiente", referencia: "r1", detalle: "sin_resultado", noEncontrado: true });
    await conciliarIntento(proveedor, {
      orderId: "p1",
      referencia: "r1",
      creadoEn: new Date(Date.now() - NO_LLEGO_MS - 1000),
    });
    expect(registrarCobro.mock.calls[0][1]).toMatchObject({ estado: "fallido", detalle: "no_llego" });
  });

  it("uno que no conoce y es reciente sigue pendiente", async () => {
    consultarPago.mockResolvedValue({ estado: "pendiente", referencia: "r1", detalle: "sin_resultado", noEncontrado: true });
    await conciliarIntento(proveedor, { orderId: "p1", referencia: "r1", creadoEn: new Date() });
    expect(registrarCobro.mock.calls[0][1]).toMatchObject({ estado: "pendiente" });
  });
});
