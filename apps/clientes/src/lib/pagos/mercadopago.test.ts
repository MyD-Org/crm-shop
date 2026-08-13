import { describe, expect, it } from "vitest";
import { claveIdempotencia, interpretar } from "./mercadopago";
import type { DatosPago } from "./tipos";

/**
 * Dos regresiones de bugs reales encontrados revisando este código antes de
 * mergearlo. Los dos habían pasado tsc, eslint, el build y 95 tests.
 */

const base: DatosPago = {
  pedidoId: "ped-1",
  monto: 1000,
  descripcion: "Pedido de prueba",
  medio: "tarjeta",
};

describe("claveIdempotencia", () => {
  /**
   * REGRESIÓN. La clave era `pedido-${pedidoId}`: la misma para todos los
   * intentos. Idempotencia en MP significa "misma clave, te devuelvo la
   * respuesta cacheada", así que un rechazo por fondos quedaba pegado y el
   * reintento con OTRA tarjeta recibía el mismo rechazo para siempre. El botón
   * "Probar de nuevo" del checkout no podía funcionar.
   */
  it("cambia cuando cambia la tarjeta", () => {
    const a = claveIdempotencia({ ...base, token: "token-tarjeta-1" });
    const b = claveIdempotencia({ ...base, token: "token-tarjeta-2" });
    expect(a).not.toBe(b);
  });

  /**
   * La otra mitad: dentro de un mismo intento tiene que ser estable, o un
   * reenvío del request cobra dos veces.
   */
  it("es estable para el mismo token", () => {
    const a = claveIdempotencia({ ...base, token: "token-tarjeta-1" });
    const b = claveIdempotencia({ ...base, token: "token-tarjeta-1" });
    expect(a).toBe(b);
  });

  it("distingue pedidos aunque el token se repitiera", () => {
    const a = claveIdempotencia({ ...base, pedidoId: "ped-1", token: "t" });
    const b = claveIdempotencia({ ...base, pedidoId: "ped-2", token: "t" });
    expect(a).not.toBe(b);
  });

  it("no filtra el token de la tarjeta dentro de la clave", () => {
    const clave = claveIdempotencia({ ...base, token: "token-secreto-abc123" });
    expect(clave).not.toContain("token-secreto-abc123");
  });

  it("sin token (dinero en cuenta) genera una clave distinta por intento", () => {
    const a = claveIdempotencia({ ...base, medio: "cuenta_mp" });
    const b = claveIdempotencia({ ...base, medio: "cuenta_mp" });
    expect(a).not.toBe(b);
  });
});

describe("interpretar", () => {
  it("traduce una orden acreditada", () => {
    const r = interpretar({
      id: "ord-1",
      status: "processed",
      transactions: { payments: [{ status: "processed", status_detail: "accredited" }] },
    });
    expect(r.estado).toBe("pagado");
    expect(r.referencia).toBe("ord-1");
    expect(r.motivo).toBeUndefined();
    expect(r.reversion).toBe(false);
  });

  it("traduce un rechazo con su motivo", () => {
    const r = interpretar({
      id: "ord-2",
      status: "failed",
      transactions: { payments: [{ status: "failed", status_detail: "insufficient_amount" }] },
    });
    expect(r.estado).toBe("fallido");
    expect(r.motivo).toBe("fondos");
    // El detalle crudo se conserva: es lo único que sirve para diagnosticar
    // cuando un cliente llama.
    expect(r.detalle).toBe("insufficient_amount");
  });

  /**
   * REGRESIÓN. `reversion` se deducía AFUERA comparando contra `estado`
   * (nuestro vocabulario) y `detalle` (el status_detail). Ninguno de los dos
   * puede valer "charged_back", así que siempre daba false — y como
   * `transicionPermitida` bloquea pagado -> fallido salvo reversión, la plata
   * se iba y el pedido quedaba cobrado para siempre.
   */
  it("detecta un contracargo", () => {
    const r = interpretar({
      id: "ord-3",
      status: "charged_back",
      transactions: { payments: [{ status: "charged_back", status_detail: "settled" }] },
    });
    expect(r.reversion).toBe(true);
    expect(r.estado).toBe("fallido");
  });

  it("detecta una devolución", () => {
    expect(interpretar({ id: "ord-4", status: "refunded" }).reversion).toBe(true);
  });

  it("detecta el contracargo aunque solo figure a nivel de orden", () => {
    // Según el momento del ciclo, el contracargo puede aparecer en la orden
    // mientras la transacción todavía dice `processed`.
    const r = interpretar({
      id: "ord-5",
      status: "charged_back",
      transactions: { payments: [{ status: "processed", status_detail: "accredited" }] },
    });
    expect(r.reversion).toBe(true);
  });

  it("un fallo común NO es una reversión", () => {
    const r = interpretar({
      id: "ord-6",
      status: "failed",
      transactions: { payments: [{ status: "failed", status_detail: "bad_filled_card_data" }] },
    });
    expect(r.reversion).toBe(false);
  });

  it("propaga el desafío 3DS", () => {
    const r = interpretar({
      id: "ord-7",
      status: "action_required",
      transactions: {
        payments: [{
          status: "action_required",
          status_detail: "pending_challenge",
          three_ds_info: { external_resource_url: "https://banco.test/acs", creq: "abc" },
        }],
      },
    });
    expect(r.estado).toBe("pendiente");
    expect(r.desafio).toEqual({ externalResourceUrl: "https://banco.test/acs", creq: "abc" });
  });
});
