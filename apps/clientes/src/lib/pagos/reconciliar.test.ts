import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * El barrido de pagos corre desde un cron, sin comprador: no pasa por
 * `esDeSuDueno`, así que el tenant lo tiene que llevar a mano. La base es
 * compartida y este Shop no debe reconciliar pedidos de otro.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
vi.mock("./mercadopago", () => ({
  mercadoPago: { id: "mercadopago", consultarPago: vi.fn() },
}));

import { reconciliarPagosPendientes } from "./reconciliar";

beforeEach(() => {
  grabadora = dbGrabadora();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reconciliarPagosPendientes", () => {
  it("solo busca candidatos del tenant de este Shop, en el esquema shop", async () => {
    const r = await reconciliarPagosPendientes();
    expect(r).toEqual({ revisados: 0, actualizados: 0, errores: 0 });

    const { sql, params } = grabadora.consultas[0];
    expect(sql).toContain('from "shop"."orders"');
    const m = sql.match(/"orders"\."tenant_id" = \$(\d+)/);
    expect(m, "falta el filtro por tenant").not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe("tenant-a");
  });

  it("sigue exigiendo proveedor y referencia: un pedido sin cobro iniciado no entra", async () => {
    await reconciliarPagosPendientes();
    const { sql } = grabadora.consultas[0];
    expect(sql).toContain('"orders"."pago_proveedor" =');
    expect(sql).toContain('"orders"."pago_referencia" is not null');
  });

  it("sin SHOP_TENANT_ID no consulta nada", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    await expect(reconciliarPagosPendientes()).rejects.toThrow(/SHOP_TENANT_ID/);
    expect(grabadora.consultas).toHaveLength(0);
  });
});
