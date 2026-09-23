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
  it("solo busca intentos del tenant de este Shop, en el esquema shop", async () => {
    const r = await reconciliarPagosPendientes();
    expect(r).toEqual({ revisados: 0, actualizados: 0, errores: 0 });

    const { sql, params } = grabadora.consultas[0];
    expect(sql).toContain('from "shop"."pago_intentos"');
    const m = sql.match(/"pago_intentos"\."tenant_id" = \$(\d+)/);
    expect(m, "falta el filtro por tenant").not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe("tenant-a");
  });

  it("recorre intentos, no pedidos: un intento viejo abierto también se consulta", async () => {
    await reconciliarPagosPendientes();
    const { sql } = grabadora.consultas[0];
    expect(sql).not.toContain('"shop"."orders"');
    expect(sql).toContain('"pago_intentos"."estado" =');
    expect(sql).toContain('"pago_intentos"."proveedor" =');
    expect(sql).toContain('"pago_intentos"."referencia" is not null');
  });

  it("sin SHOP_TENANT_ID no consulta nada", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    await expect(reconciliarPagosPendientes()).rejects.toThrow(/SHOP_TENANT_ID/);
    expect(grabadora.consultas).toHaveLength(0);
  });
});
