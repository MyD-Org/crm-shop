import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * La búsqueda sin tildes usa una función SQL propia. Desde que las tablas del
 * Shop viven en el esquema `shop` de la base del CRM, la función también: tiene
 * que llamarse calificada, porque el `search_path` de la conexión no es algo de
 * lo que se pueda depender (por el pooler, el del rol puede no aplicarse).
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getCatalogo } from "./catalog";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora();
});

describe("búsqueda del catálogo", () => {
  it('llama a "shop".immutable_unaccent, nunca a la función sin calificar', async () => {
    await getCatalogo({ busqueda: "lampara" });

    const { sql, params } = grabadora.consultas[0];
    expect(sql).toContain('"shop".immutable_unaccent(');
    // Toda aparición del nombre viene precedida por el esquema.
    const total = sql.match(/immutable_unaccent\(/g)?.length ?? 0;
    const calificadas = sql.match(/"shop"\.immutable_unaccent\(/g)?.length ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(calificadas).toBe(total);
    expect(params).toContain("%lampara%");
  });

  it("busca sobre la vista del CRM (nombre, código y descripción), no sobre la copia vieja del Shop", async () => {
    // "lampara" encuentra "Lámpara colgante": unaccent + lower en los dos lados.
    await getCatalogo({ busqueda: "lampara" });
    const { sql } = grabadora.consultas[0];
    expect(sql).toContain('from "public"."catalog_products_shop"');
    for (const col of ["name", "code", "description"]) {
      expect(sql).toContain(
        `"shop".immutable_unaccent(lower("catalog_products_shop"."${col}")) LIKE "shop".immutable_unaccent(lower($`,
      );
    }
    expect(sql).not.toContain('"shop"."catalog_products"');
    expect(sql).not.toContain('"public"."catalog_products"');
    expect(sql).not.toMatch(/from "catalog_products"/);
  });
});
