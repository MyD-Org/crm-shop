import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda ESTÁTICA de la baseline del esquema `shop`.
 *
 * No aplica nada contra una base: lee `drizzle/0000_baseline.sql` como texto.
 * Existe porque la baseline se GENERA con drizzle-kit y después se edita a mano
 * (ver el encabezado del .sql): `CREATE SCHEMA IF NOT EXISTS`, la extensión
 * `unaccent` y la función `"shop".immutable_unaccent` no se pueden modelar en
 * `schema.ts`. Si alguien regenera la baseline y pierde esas ediciones, el
 * primer `db:migrate` falla recién contra una base real; este test lo agarra
 * antes, en el CI sin base del Shop.
 *
 * La aplicación real de la baseline la ejercita la suite de integración del
 * admin (única con Postgres) y el ensayo manual del runbook.
 */

const DRIZZLE_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));
const BASELINE = `${DRIZZLE_DIR}/0000_baseline.sql`;
const JOURNAL = `${DRIZZLE_DIR}/meta/_journal.json`;

const leerBaseline = () => readFileSync(BASELINE, "utf8");

describe("baseline del esquema shop (estático)", () => {
  it("la baseline es la primera migración y las siguientes son incrementales", () => {
    const sqls = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(sqls[0]).toBe("0000_baseline.sql");

    const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries[0].tag).toBe("0000_baseline");
    // Cada .sql tiene su entrada en el journal, en orden: un archivo suelto o
    // una entrada sin archivo hacen que el migrador salte o falle en silencio.
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(sqls);
    expect(journal.entries.map((e) => e.idx)).toEqual(sqls.map((_, i) => i));

    // Nada después de la baseline vuelve a crear tablas: la baseline ya está
    // aplicada en producción y solo se puede sumar por ALTER.
    for (const f of sqls.slice(1)) {
      expect(readFileSync(`${DRIZZLE_DIR}/${f}`, "utf8")).not.toContain("CREATE TABLE");
    }
  });

  it("0001 agrega el teléfono de contacto al perfil de facturación", () => {
    const sql = readFileSync(`${DRIZZLE_DIR}/0001_telefono_contacto.sql`, "utf8");
    expect(sql).toContain(
      'ALTER TABLE "shop"."billing_profiles" ADD COLUMN "telefono" text',
    );
  });

  it("conserva las ediciones a mano (esquema idempotente, unaccent, función calificada)", () => {
    const sql = leerBaseline();
    // El migrador ya creó el esquema para su tabla de control: sin IF NOT EXISTS
    // la baseline falla con "schema shop already exists".
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "shop"');
    expect(sql).not.toMatch(/CREATE SCHEMA "shop"/);
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public");
    expect(sql).toContain('"shop".immutable_unaccent');
  });

  it("las 15 tablas viven en el esquema shop", () => {
    const creates = leerBaseline()
      .split("\n")
      .filter((l) => l.includes("CREATE TABLE"));
    expect(creates).toHaveLength(15);
    for (const linea of creates) {
      expect(linea).toMatch(/^CREATE TABLE "shop"\."/);
    }
  });

  it("no referencia tablas de public (la FK de order_items apunta a shop.orders)", () => {
    const sql = leerBaseline();
    expect(sql).toContain('REFERENCES "shop"."orders"');
    expect(sql).not.toContain('REFERENCES "public".');
    expect(sql).not.toContain('"public"."orders"');
  });

  it("orders trae tenant obligatorio, su índice y los dos CHECK", () => {
    const sql = leerBaseline();
    expect(sql).toContain('"tenant_id" text NOT NULL');
    expect(sql).toContain("orders_tenant_fecha");
    expect(sql).toContain("orders_estado_check");
    expect(sql).toContain("orders_cancelacion_motivo_check");
  });
});
