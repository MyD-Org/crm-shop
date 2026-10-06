import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * CARACTERIZACIÓN (rebanada A de payway-cobro): hoy sólo los pedidos de `mercadopago` cuentan como
 * "pago en línea". El rescate del checkout (`pedidoPendienteMasReciente`) filtra por ese método y la
 * ventana de pago se aplica sólo a él. Tiene que seguir igual al generalizar el procesador.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { calcularReservaVenceEn, pedidoPendienteMasReciente } from "./pedidos";

beforeEach(() => {
  grabadora = dbGrabadora();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
});

describe("pago en línea de Mercado Pago — caracterización", () => {
  it("el rescate del checkout sólo busca pedidos pendientes pagados con mercadopago", async () => {
    await pedidoPendienteMasReciente({ clerkUserId: "user_1", clienteCodigo: "C-1" });
    const { sql, params } = grabadora.consultas[0];
    expect(sql).toContain('"orders"."pago_metodo"');
    expect(params).toContain("mercadopago");
    expect(params).toContain("pendiente");
  });

  it("la reserva con pago online usa la ventana de 24 h; un medio manual no", () => {
    const ahora = new Date("2026-01-01T12:00:00Z");
    expect(calcularReservaVenceEn("mercadopago", { reservaDias: 3 }, ahora)).toEqual(
      new Date("2026-01-02T12:00:00Z"),
    );
    expect(calcularReservaVenceEn("transferencia", { reservaDias: 3 }, ahora)).toEqual(
      new Date("2026-01-04T12:00:00Z"),
    );
  });
});
