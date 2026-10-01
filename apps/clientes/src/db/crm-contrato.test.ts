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
    for (const prohibida of ["raw", "phones_norm", "seller_id"]) {
      expect(vista[prohibida], prohibida).toBeUndefined();
    }
  });

  it("la vista del espejo trae los teléfonos del contacto (0036 del CRM)", () => {
    const vista = esperado["public.alegra_contacts_shop"];
    expect(vista.phone_primary).toBe("text");
    expect(vista.phone_secondary).toBe("text");
    expect(vista.mobile).toBe("text");
  });

  it("la vista del espejo trae acceso_facturacion al final (0039 del CRM)", () => {
    const vista = esperado["public.alegra_contacts_shop"];
    expect(vista.acceso_facturacion).toBe("boolean");
    expect(Object.keys(vista).at(-1)).toBe("acceso_facturacion");
    // La excepción vive en una tabla del CRM que el Shop no lee: sólo la columna calculada.
    expect(esperado["public.contactos_acceso_facturacion"]).toBeUndefined();
  });

  it("la vista de catálogo trae el producto entero (0037) pero nunca `raw`", () => {
    const vista = esperado["public.catalog_products_shop"];
    expect(Object.keys(vista)).toEqual([
      "tenant_id",
      "alegra_id",
      "stock",
      "precios_alegra",
      "activo",
      "alegra_leido_at",
      "name",
      "description",
      "code",
      "brand",
      "category_alegra_id",
      "iva_porcentaje",
    ]);
    for (const prohibida of ["raw", "images", "prices", "status", "alegra_status"]) {
      expect(vista[prohibida], prohibida).toBeUndefined();
    }
  });

  it("la vista de categorías de Alegra trae sólo lo que usa el catálogo", () => {
    expect(Object.keys(esperado["public.catalog_categories_shop"])).toEqual([
      "tenant_id",
      "alegra_id",
      "name",
      "parent_alegra_id",
      "activo",
    ]);
  });

  it("de sucursales sólo se declaran las columnas concedidas por el GRANT (0041 y 0051 del CRM)", () => {
    expect(Object.keys(esperado["public.sucursales"])).toEqual([
      "tenant_id",
      "slug",
      "nombre",
      "direccion",
      "ciudad",
      "provincia",
      "whatsapp",
      "horario",
      "schedule",
      "schedule_exceptions",
      "acepta_retiro",
      "acepta_envio",
      "envio_ciudades",
      "orden",
      "activa",
      "predeterminada",
    ]);
    for (const prohibida of ["id", "maestra", "deposito_alegra_id", "created_at", "updated_at"]) {
      expect(esperado["public.sucursales"][prohibida], prohibida).toBeUndefined();
    }
  });

  it("del stock por sucursal sólo se declaran las columnas del GRANT (0042 del CRM)", () => {
    expect(Object.keys(esperado["public.catalog_stock_sucursal"])).toEqual([
      "tenant_id",
      "sucursal",
      "alegra_id",
      "stock",
      "leido_at",
    ]);
    // `item_id_cuenta` es el id del ítem en la cuenta de Alegra de la sucursal: no se concede.
    for (const prohibida of ["item_id_cuenta", "origen", "synced_at"]) {
      expect(esperado["public.catalog_stock_sucursal"][prohibida], prohibida).toBeUndefined();
    }
  });

  it("de tenants sólo se declaran las columnas del GRANT", () => {
    expect(Object.keys(esperado["public.tenants"]).sort()).toEqual(
      ["id", "name", "receipts_email", "whatsapp_number"],
    );
  });
});
