import { describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));

const dbActual = { db: null as unknown };
vi.mock("@/db", () => ({ getDb: () => dbActual.db }));

import { leerCuentasBancarias, leerCuentasBancariasEnTx } from "./cuentas-bancarias-repo";

const FILA = [
  "11111111-1111-1111-1111-111111111111",
  "alias.ejemplo",
  "0000000000000000000000",
  "Banco Ejemplo",
  "Titular Ejemplo SA",
  "30000000000",
  false,
  ["mdp", "igz"],
  "1000.00",
  null,
  true,
  false,
  3,
];

describe("leerCuentasBancarias", () => {
  it("pide sólo las columnas concedidas, del tenant, contra public.cuentas_bancarias_shop", async () => {
    const g = dbGrabadora(() => [FILA]);
    const r = await leerCuentasBancarias(g.db as never);
    expect(r).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        alias: "alias.ejemplo",
        cbu: "0000000000000000000000",
        banco: "Banco Ejemplo",
        titular: "Titular Ejemplo SA",
        cuit: "30000000000",
        todasLasSucursales: false,
        sucursalSlugs: ["mdp", "igz"],
        montoMin: 1000,
        montoMax: null,
        activa: true,
        predeterminada: false,
        orden: 3,
      },
    ]);
    const { sql, params } = g.consultas[0];
    expect(sql).toContain('"public"."cuentas_bancarias_shop"');
    expect(sql).toContain('"tenant_id" = $1');
    expect(sql).not.toContain("created_at");
    expect(sql).not.toContain("updated_at");
    expect(params).toContain("tenant-ejemplo");
  });

  it("tira si la tabla no existe", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.reject(new Error('relation "cuentas_bancarias_shop" does not exist')) }) }) }),
    };
    await expect(leerCuentasBancarias(db as never)).rejects.toThrow(/does not exist/);
  });
});

describe("leerCuentasBancariasEnTx", () => {
  it("con la tabla ausente devuelve [] (en un savepoint, sin abortar la transacción)", async () => {
    const savepoint = vi.fn(async (fn: (sp: unknown) => unknown) => fn(dbSinTabla));
    const dbSinTabla = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.reject(new Error("relation does not exist")) }) }) }),
    };
    const tx = { transaction: savepoint };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(leerCuentasBancariasEnTx(tx as never)).resolves.toEqual([]);
    expect(savepoint).toHaveBeenCalledTimes(1);
  });

  it("con la tabla presente devuelve las cuentas", async () => {
    const g = dbGrabadora(() => [FILA]);
    const r = await leerCuentasBancariasEnTx(g.db as never);
    expect(r).toHaveLength(1);
    expect(r[0].montoMin).toBe(1000);
  });
});
