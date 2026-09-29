import { describe, expect, it, vi } from "vitest";

vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));

import { leerSucursalesYZonas } from "./sucursales-repo";
import { getTableColumns } from "drizzle-orm";
import { crmSucursales } from "@/db/crm";

/** La lectura filtra por tenant y sólo pide columnas concedidas por el GRANT del CRM. */
describe("leerSucursalesYZonas", () => {
  it("consulta sucursales y zonas con where de tenant", async () => {
    const wheres: unknown[] = [];
    const db = {
      select: (cols: Record<string, unknown>) => ({
        from: () => ({
          where: async (w: unknown) => {
            wheres.push(w);
            return "slug" in cols ? [{ slug: "s" }] : [{ id: "z" }];
          },
        }),
      }),
    };
    const r = await leerSucursalesYZonas(db as never);
    expect(wheres).toHaveLength(2);
    expect(r).toEqual({ sucursales: [{ slug: "s" }], zonas: [{ id: "z" }] });
  });

  it("no pide columnas fuera del contrato", () => {
    expect(Object.keys(getTableColumns(crmSucursales))).not.toContain(
      "cuentaAlegraId",
    );
  });
});
