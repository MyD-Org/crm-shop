import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getViewConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { VENTANA_PAGO_MS } from "@/lib/pedidos";
import { stockReservado } from "./schema";

/**
 * Guarda ESTÁTICA de la vista `shop.stock_reservado` (migración 0010).
 *
 * La vista vive sólo en SQL: drizzle-kit no la genera ni la compara. Este test
 * lee el .sql como texto y fija las reglas de negocio que no pueden derivar sin
 * que nadie se entere. La semántica contra Postgres (qué pedido reserva y cuál
 * no, y la carrera de dos checkouts) la ejerce la suite de integración del
 * admin, única con base.
 */

const SQL = readFileSync(
  fileURLToPath(new URL("../../drizzle/0010_stock_reservado.sql", import.meta.url)),
  "utf8",
);
/** Sin comentarios: lo que Postgres ejecuta. */
const CODIGO = SQL.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("shop.stock_reservado (0010)", () => {
  it("la ventana del pendiente es la misma que VENTANA_PAGO_MS", () => {
    const m = CODIGO.match(/interval '(\d+) hours'/);
    expect(m, "la vista tiene que vencer el pendiente por horas").not.toBeNull();
    expect(Number(m![1]) * 60 * 60_000).toBe(VENTANA_PAGO_MS);
  });

  it("reservan los estados vivos; cancelado, entregado y facturado no", () => {
    expect(CODIGO).toContain("o.facturado_en IS NULL");
    expect(CODIGO).toContain("o.estado IN ('confirmado', 'preparacion', 'en_camino')");
    expect(CODIGO).toContain("o.estado = 'pendiente'");
    expect(CODIGO).not.toMatch(/'cancelado'|'entregado'/);
  });

  it("un pendiente pagado online no vence", () => {
    expect(CODIGO).toContain("OR o.pago_estado = 'pagado'");
  });

  it("agrupa por tenant e ítem, con las columnas que declara schema.ts", () => {
    expect(CODIGO).toMatch(/CREATE VIEW "shop"\."stock_reservado" AS/);
    expect(CODIGO).toContain("GROUP BY o.tenant_id, oi.alegra_item_id");
    const { name, schema, selectedFields } = getViewConfig(stockReservado);
    expect(`${schema}.${name}`).toBe("shop.stock_reservado");
    const columnas = Object.values(selectedFields).map((c) => (c as { name: string }).name);
    expect(columnas).toEqual(["tenant_id", "alegra_item_id", "qty"]);
    for (const c of ["o.tenant_id", "oi.alegra_item_id", "sum(oi.qty) AS qty"]) {
      expect(CODIGO).toContain(c);
    }
  });

  it("el GRANT a shop_app es condicional (crm_test y las ramas no tienen el rol)", () => {
    expect(CODIGO).toMatch(
      /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'\) THEN\s+GRANT SELECT ON "shop"\."stock_reservado" TO shop_app;/,
    );
  });
});
