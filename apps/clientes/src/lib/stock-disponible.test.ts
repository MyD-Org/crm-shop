import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { crmCatalogo } from "@/db/crm";
import { stockReservado } from "@/db/schema";
import {
  activoSql,
  disponiblesEnTx,
  estadoSql,
  joinReserva,
  preciosSql,
  StockInsuficienteError,
  stockSql,
} from "./stock-disponible";

/**
 * Forma del SQL del disponible: una sola fuente (la vista del CRM) menos la
 * reserva de los pedidos vivos del Shop. La aritmética (5 − 3 = 2, 5 − 6 → 0,
 * null → null) la hace Postgres; acá se fija que la expresión sea ésa.
 */

beforeEach(() => vi.stubEnv("SHOP_TENANT_ID", "tenant-test"));
afterEach(() => vi.unstubAllEnvs());

function consulta() {
  const { db, consultas } = dbGrabadora();
  const q = db
    .select({ stock: stockSql, precios: preciosSql, activo: activoSql, estado: estadoSql })
    .from(crmCatalogo)
    .leftJoin(stockReservado, joinReserva())
    .toSQL();
  expect(consultas).toHaveLength(0);
  return q;
}

/** Left join a la reserva, con el tenant del Shop EN el join. */
const JOIN_RESERVA =
  /left join "shop"\."stock_reservado" on \("stock_reservado"\."alegra_item_id" = "catalog_products_shop"\."alegra_id" and "stock_reservado"\."tenant_id" = \$(\d+)\)/;

describe("una sola fuente: la vista del CRM", () => {
  it("stock, precios y estado salen de la vista, sin elegir por fila", () => {
    const { sql } = consulta();
    expect(sql).toContain('from "public"."catalog_products_shop"');
    expect(sql).not.toContain('"shop"."catalog_products"');
    expect(sql).not.toContain("alegra_leido_at");
    expect(sql).toContain('"catalog_products_shop"."precios_alegra"');
    expect(sql).toContain(`(case when "catalog_products_shop"."activo" then 'active' else 'inactive' end)`);
  });

  it("sin tenant no arma la consulta", () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    expect(() => consulta()).toThrow(/SHOP_TENANT_ID/);
  });
});

describe("disponible = stock − reservado", () => {
  it("left join a shop.stock_reservado con el tenant del Shop en el join", () => {
    const { sql, params } = consulta();
    const m = sql.match(JOIN_RESERVA);
    expect(m, sql).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe("tenant-test");
  });

  it("resta la reserva, nunca negativo (5 − 3 = 2; 5 − 6 → 0); stock null sigue null", () => {
    expect(consulta().sql).toContain(
      '(case when "catalog_products_shop"."stock" is null then null else greatest(0, "catalog_products_shop"."stock" - coalesce("stock_reservado"."qty", 0)) end)',
    );
  });
});

describe("disponiblesEnTx", () => {
  it("relee con la misma expresión sólo los ids pedidos, del tenant del Shop", async () => {
    const { db, consultas } = dbGrabadora(() => [
      ["5", "2"],
      ["7", null],
    ]);
    const r = await disponiblesEnTx(db as never, ["5", "7"]);
    expect(r).toEqual(
      new Map<string, number | null>([
        ["5", 2],
        ["7", null],
      ]),
    );
    expect(consultas).toHaveLength(1);
    const [c] = consultas;
    expect(c.sql).toContain('from "public"."catalog_products_shop"');
    expect(c.sql).toMatch(JOIN_RESERVA);
    const m = c.sql.match(
      /where \("catalog_products_shop"\."tenant_id" = \$(\d+) and "catalog_products_shop"\."alegra_id" in \(\$\d+, \$\d+\)\)/,
    );
    expect(m, c.sql).not.toBeNull();
    expect(c.params[Number(m![1]) - 1]).toBe("tenant-test");
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
