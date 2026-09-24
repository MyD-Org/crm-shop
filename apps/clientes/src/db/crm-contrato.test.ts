import { describe, expect, it } from "vitest";
import { getTableConfig, getViewConfig, PgColumn, PgTable, PgView } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as crm from "./crm";
import contrato from "./__fixtures__/crm-contrato.json";

/**
 * Contrato de columnas CRM → Shop (DAT-2 de `portal-al-shop`).
 *
 * El Shop lee y escribe tablas de `public` cuyo DDL es de apps/admin. Lo que
 * declara `crm.ts` tiene que coincidir con `__fixtures__/crm-contrato.json`
 * (tabla → columna → tipo SQL). Del lado del CRM, un test de integración lee el
 * MISMO fixture y lo verifica contra la base migrada: si el CRM renombra o
 * cambia el tipo de una columna, falla uno de los dos, nombrando la columna.
 */

type Contrato = Record<string, Record<string, string>>;

/** `public.<tabla>` → { columna: tipo SQL } de todo lo que declara crm.ts. */
function contratoDeclarado(): Contrato {
  const out: Contrato = {};
  for (const valor of Object.values(crm)) {
    if (is(valor, PgTable)) {
      const cfg = getTableConfig(valor);
      out[`${cfg.schema ?? "public"}.${cfg.name}`] = Object.fromEntries(
        cfg.columns.map((c) => [c.name, c.getSQLType()]),
      );
    } else if (is(valor, PgView)) {
      const cfg = getViewConfig(valor);
      out[`${cfg.schema ?? "public"}.${cfg.name}`] = Object.fromEntries(
        Object.values(cfg.selectedFields)
          .filter((c): c is PgColumn => is(c, PgColumn))
          .map((c) => [c.name, c.getSQLType()]),
      );
    }
  }
  return out;
}

const esperado = contrato as Contrato;

describe("contrato de columnas del CRM (crm.ts ↔ crm-contrato.json)", () => {
  const declarado = contratoDeclarado();

  it("declara exactamente las tablas y vistas del contrato", () => {
    expect(Object.keys(declarado).sort()).toEqual(Object.keys(esperado).sort());
  });

  for (const [tabla, columnas] of Object.entries(esperado)) {
    it(`${tabla}: mismas columnas y tipos`, () => {
      const real = declarado[tabla] ?? {};
      for (const [columna, tipo] of Object.entries(columnas)) {
        expect(real[columna], `${tabla}.${columna}`).toBe(tipo);
      }
      for (const columna of Object.keys(real)) {
        expect(columnas[columna], `${tabla}.${columna} no está en el contrato`).toBeDefined();
      }
    });
  }

  it("la vista del espejo no expone datos sensibles", () => {
    const vista = esperado["public.alegra_contacts_shop"];
    for (const prohibida of ["raw", "phone_primary", "phone_secondary", "mobile", "phones_norm", "seller_id"]) {
      expect(vista[prohibida], prohibida).toBeUndefined();
    }
  });

  it("de tenants sólo se declaran las columnas del GRANT", () => {
    expect(Object.keys(esperado["public.tenants"]).sort()).toEqual(
      ["id", "name", "receipts_email", "whatsapp_number"],
    );
  });
});
