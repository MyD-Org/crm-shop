import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { catalogProducts } from "@/db/schema";
import { crmStock } from "@/db/crm";
import { stockReservado } from "@/db/schema";
import {
  activoSql,
  disponiblesEnTx,
  joinReserva,
  joinStockCrm,
  preciosSql,
  StockInsuficienteError,
  stockSql,
} from "./stock-disponible";

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
    .leftJoin(stockReservado, joinReserva())
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
    // Cuatro elecciones: el stock aparece dos veces (el "is null" y la resta de la reserva).
    expect(sql.split(USAR_CRM)).toHaveLength(5);
    expect(sql).toContain('then "catalog_products_shop"."stock" else "shop"."catalog_products"."stock" end');
    expect(sql).toContain('then "catalog_products_shop"."precios_alegra" else "shop"."catalog_products"."prices" end');
    expect(sql).toContain(`then "catalog_products_shop"."activo" else "shop"."catalog_products"."status" = 'active' end`);
  });

  it("sin tenant no arma la consulta", () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    expect(() => consulta()).toThrow(/SHOP_TENANT_ID/);
  });
});

/** Left join a la reserva, con el tenant del Shop EN el join. */
const JOIN_RESERVA =
  /left join "shop"\."stock_reservado" on \("stock_reservado"\."alegra_item_id" = "shop"\."catalog_products"\."alegra_id" and "stock_reservado"\."tenant_id" = \$(\d+)\)/;

describe("disponible = stock − reservado", () => {
  it("left join a shop.stock_reservado con el tenant del Shop en el join", () => {
    const { sql, params } = consulta();
    const m = sql.match(JOIN_RESERVA);
    expect(m, sql).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe("tenant-test");
  });

  it("resta la reserva sobre el stock de la fuente elegida, nunca negativo; null sigue null", () => {
    const { sql } = consulta();
    expect(sql).toMatch(
      /\(case when \(case when .+ end\) is null then null else greatest\(0, \(case when .+ end\) - coalesce\("stock_reservado"\."qty", 0\)\) end\)/,
    );
  });
});

describe("disponiblesEnTx", () => {
  it("relee con la misma expresión (fuente + reserva) sólo los ids pedidos", async () => {
    const { db, consultas } = dbGrabadora(() => [
      ["5", "3"],
      ["7", null],
    ]);
    const r = await disponiblesEnTx(db as never, ["5", "7"]);
    expect(r).toEqual(
      new Map<string, number | null>([
        ["5", 3],
        ["7", null],
      ]),
    );
    expect(consultas).toHaveLength(1);
    const [c] = consultas;
    expect(c.sql).toMatch(JOIN_RESERVA);
    expect(c.sql).toContain('left join "public"."catalog_products_shop"');
    expect(c.sql).toMatch(/"shop"\."catalog_products"\."alegra_id" in \(\$\d+, \$\d+\)/);
  });

  it("sin ids no consulta", async () => {
    const { db, consultas } = dbGrabadora();
    expect(await disponiblesEnTx(db as never, [])).toEqual(new Map());
    expect(consultas).toHaveLength(0);
  });
});

describe("StockInsuficienteError", () => {
  it("lleva los ids que no alcanzan", () => {
    const e = new StockInsuficienteError(["5"]);
    expect(e).toBeInstanceOf(Error);
    expect(e.ids).toEqual(["5"]);
    expect(e.name).toBe("StockInsuficienteError");
  });
});
