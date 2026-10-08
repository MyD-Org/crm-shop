import { describe, expect, it } from "vitest";
import mediosDePago from "./__fixtures__/mercadopago/payment-methods.json";
import { IDS_MERCADO_PAGO, marcaDeMercadoPago } from "./marcas";

/**
 * Los `payment_method_id` de Mercado Pago del mapa de marcas existen de verdad: fixture capturado de
 * `GET /v1/payment_methods` (cuenta de prueba, 2026-10-08). Un id inventado haría que una tarjeta real
 * nunca matchee su marca (y pierda sus cuotas sin interés).
 */
describe("marcas.ts contra /v1/payment_methods", () => {
  const activos = new Set(
    mediosDePago
      .filter((m) => m.status === "active" && (m.payment_type_id === "credit_card" || m.payment_type_id === "debit_card"))
      .map((m) => m.id),
  );

  it.each([...IDS_MERCADO_PAGO])("%s es un medio de tarjeta activo en Mercado Pago", (id) => {
    expect(activos.has(id)).toBe(true);
  });

  it("toda tarjeta activa de Mercado Pago tiene marca", () => {
    for (const id of activos) expect(marcaDeMercadoPago(id), id).not.toBeNull();
  });
});
