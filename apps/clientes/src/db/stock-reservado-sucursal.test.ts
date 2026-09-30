import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getViewConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { stockReservadoSucursal } from "./schema";

/**
 * Guarda ESTÁTICA de la vista `shop.stock_reservado_sucursal` (migración 0024, rebanada B del
 * change `sucursales-igz-mdp`) y de su convivencia con la 0012.
 *
 * La vista vive sólo en SQL. Acá se fijan sus predicados y que la 0012 y sus lectores no cambiaron
 * en el lote 1: la migración de los lectores a la vista nueva es del lote 2, detrás del flag
 * `disponibilidad-sucursal`. La semántica contra Postgres se ensayó en la base local (ver el
 * header de la 0024).
 */

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
const sinComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const SQL_0012 = leer("../../drizzle/0012_stock_reservado.sql");
const SQL_0024 = leer("../../drizzle/0024_orders_reserva_sucursal.sql");
const SQL_0025 = leer("../../drizzle/0025_stock_reservado_sucursal_vence.sql");
const CODIGO_0024 = sinComentarios(SQL_0024);
// La definición vigente de la vista es la de la 0025 (recrea la de la 0024).
const CODIGO = sinComentarios(SQL_0025);

describe("la vista 0012 no cambió (guarda del lote 1 de la rebanada B)", () => {
  it("el archivo de la migración 0012 es byte a byte el de siempre", () => {
    const hash = createHash("sha256").update(SQL_0012).digest("hex");
    expect(hash).toBe("5d16bac12e923eb252652f51dc8e5aee34768b42fd5eac751825f1027b41ce54");
  });

  it("la 0024 no toca la vista stock_reservado", () => {
    expect(CODIGO_0024).not.toMatch(/"shop"\."stock_reservado"(?!_)/);
    expect(CODIGO_0024).not.toMatch(/DROP VIEW/i);
    expect(CODIGO).not.toMatch(/"shop"\."stock_reservado"(?!_)/);
    expect(CODIGO).toContain('DROP VIEW "shop"."stock_reservado_sucursal";');
  });

  it("stock-disponible.ts sigue leyendo la 0012, no la vista por sucursal", () => {
    const fuente = leer("../lib/stock-disponible.ts");
    expect(fuente).toMatch(/import \{ stockReservado \} from "@\/db\/schema"/);
    expect(fuente).not.toContain("stockReservadoSucursal");
    expect(fuente).not.toContain("stock_reservado_sucursal");
  });
});

describe("shop.stock_reservado_sucursal (0024, recreada por la 0025)", () => {
  it("agrupa por tenant, sucursal de reserva e ítem, con las columnas que declara schema.ts", () => {
    expect(CODIGO).toMatch(/CREATE VIEW "shop"\."stock_reservado_sucursal" AS/);
    expect(CODIGO).toContain("coalesce(oi.a_traer_de, o.sucursal) AS sucursal");
    expect(CODIGO).toContain("GROUP BY o.tenant_id, coalesce(oi.a_traer_de, o.sucursal), oi.alegra_item_id");
    const { name, schema, selectedFields } = getViewConfig(stockReservadoSucursal);
    expect(`${schema}.${name}`).toBe("shop.stock_reservado_sucursal");
    const columnas = Object.values(selectedFields).map((c) => (c as { name: string }).name);
    expect(columnas).toEqual(["tenant_id", "sucursal", "alegra_item_id", "qty"]);
  });

  it("reservan los estados vivos; cancelado y entregado no", () => {
    expect(CODIGO).toContain("o.estado IN ('pendiente', 'confirmado', 'preparacion', 'en_camino')");
    expect(CODIGO).not.toMatch(/'cancelado'|'entregado'/);
  });

  it("un facturado sólo reserva si la factura es cruzada", () => {
    expect(CODIGO).toContain("(o.facturado_en IS NULL OR o.factura_cruzada)");
  });

  it("el pendiente reserva si está pagado o su vencimiento es futuro; NULL = 24 h desde created_at", () => {
    expect(CODIGO).toContain("o.estado <> 'pendiente'");
    expect(CODIGO).toContain("o.pago_estado = 'pagado'");
    expect(CODIGO).toContain("coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now()");
    // NULL ya NO significa "no vence": "nunca" es 'infinity'.
    expect(CODIGO).not.toContain("o.reserva_vence_en IS NULL");
  });

  it("los pedidos sin sucursal no entran", () => {
    expect(CODIGO).toContain("AND coalesce(oi.a_traer_de, o.sucursal) IS NOT NULL");
  });

  it("los pendientes sin pago existentes conservan su ventana de 24 h (backfill)", () => {
    expect(CODIGO_0024).toMatch(
      /UPDATE "shop"\."orders"\s+SET "reserva_vence_en" = "created_at" \+ interval '24 hours'\s+WHERE "estado" = 'pendiente' AND "pago_estado" <> 'pagado' AND "reserva_vence_en" IS NULL/,
    );
  });

  it("agrega exactamente las columnas acordadas con el CRM", () => {
    for (const c of [
      'ALTER TABLE "shop"."order_items" ADD COLUMN "a_traer_de" text;',
      'ALTER TABLE "shop"."orders" ADD COLUMN "factura_cruzada" boolean DEFAULT false NOT NULL;',
      'ALTER TABLE "shop"."orders" ADD COLUMN "reserva_vence_en" timestamp with time zone;',
      'ALTER TABLE "shop"."orders" ADD COLUMN "contactado_en" timestamp with time zone;',
      'ALTER TABLE "shop"."orders" ADD COLUMN "contactado_por" uuid;',
      'ALTER TABLE "shop"."orders" ADD COLUMN "contactado_por_nombre" text;',
    ]) {
      expect(CODIGO_0024).toContain(c);
    }
  });

  it("documenta la reversa y el drift que vive sólo en SQL", () => {
    for (const sql of [SQL_0024, SQL_0025]) {
      expect(sql).toContain("Reversa");
      expect(sql).toContain('DROP VIEW "shop"."stock_reservado_sucursal"');
      expect(sql).toContain("Drift que vive SOLO en SQL");
    }
  });

  it("el GRANT a shop_app es condicional", () => {
    expect(CODIGO).toMatch(
      /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'\) THEN\s+GRANT SELECT ON "shop"\."stock_reservado_sucursal" TO shop_app;/,
    );
  });
});
