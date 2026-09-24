import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { catalogProducts } from "@/db/schema";
import { crmStock } from "@/db/crm";
import { activoSql, joinStockCrm, preciosSql, stockSql } from "./stock-disponible";

/**
 * Forma del SQL que elige, por fila, entre el espejo del Shop y la vista del
 * CRM. La semántica (qué fila gana) se ejerce contra Postgres; acá se fija que
 * las expresiones comparen lo que tienen que comparar.
 */

beforeEach(() => vi.stubEnv("SHOP_TENANT_ID", "tenant-test"));
afterEach(() => vi.unstubAllEnvs());

/** La vista se nombra sin esquema en las columnas: es la única relación con ese nombre en el FROM. */
const USAR_CRM =
  '(case when ("catalog_products_shop"."alegra_leido_at" is not null and "catalog_products_shop"."alegra_leido_at" > "shop"."catalog_products"."synced_at") then';

function consulta() {
  const { db, consultas } = dbGrabadora();
  const q = db
    .select({ stock: stockSql, precios: preciosSql, activo: activoSql })
    .from(catalogProducts)
    .leftJoin(crmStock, joinStockCrm())
    .toSQL();
  expect(consultas).toHaveLength(0);
  return q;
}

describe("fuente de stock por fila", () => {
  it("left join a la vista del CRM con el tenant del Shop en el join", () => {
    const { sql, params } = consulta();
    const m = sql.match(
      /left join "public"\."catalog_products_shop" on \("catalog_products_shop"\."alegra_id" = "shop"\."catalog_products"\."alegra_id" and "catalog_products_shop"\."tenant_id" = \$(\d+)\)/,
    );
    expect(m, sql).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe("tenant-test");
  });

  it("el CRM gana sólo si se leyó de Alegra después que la fila del Shop", () => {
    expect(consulta().sql).toContain(USAR_CRM);
  });

  it("stock, precios y estado salen de la misma elección", () => {
    const { sql } = consulta();
    expect(sql.split(USAR_CRM)).toHaveLength(4);
    expect(sql).toContain('then "catalog_products_shop"."stock" else "shop"."catalog_products"."stock" end');
    expect(sql).toContain('then "catalog_products_shop"."precios_alegra" else "shop"."catalog_products"."prices" end');
    expect(sql).toContain(`then "catalog_products_shop"."activo" else "shop"."catalog_products"."status" = 'active' end`);
  });

  it("sin tenant no arma la consulta", () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    expect(() => consulta()).toThrow(/SHOP_TENANT_ID/);
  });
});
