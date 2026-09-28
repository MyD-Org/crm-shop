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
    await getCatalogo({ soloVisibles: false, busqueda: "lampara" });

    const { sql, params } = grabadora.consultas[0];
    expect(sql).toContain('"shop".immutable_unaccent(');
    // Toda aparición del nombre viene precedida por el esquema.
    const total = sql.match(/immutable_unaccent\(/g)?.length ?? 0;
    const calificadas = sql.match(/"shop"\.immutable_unaccent\(/g)?.length ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(calificadas).toBe(total);
    expect(params).toContain("%lampara%");
  });


  it("busca sobre la vista del CRM, en nombre curado, nombre, código, descripción, marca y categoría", async () => {
    await getCatalogo({ soloVisibles: false, busqueda: "lampara" });
    const { sql } = grabadora.consultas[0];
    expect(sql).toContain('from "public"."catalog_products_shop"');
    expect(sql).toContain(
      `"shop".immutable_unaccent(lower(concat_ws(' ', "public"."catalog_overlay"."nombre", "catalog_products_shop"."name", "catalog_products_shop"."code", "catalog_products_shop"."description", "catalog_products_shop"."brand", "catalog_categories_shop"."name"))) LIKE $`,
    );
    expect(sql).not.toContain('"shop"."catalog_products"');
    expect(sql).not.toContain('"public"."catalog_products"');
    expect(sql).not.toMatch(/from "catalog_products"/);
  });

  it("cada término es su propia condición (en cualquier orden), con plurales reducidos", async () => {
    await getCatalogo({ soloVisibles: false, busqueda: "Lámparas LED" });
    const { sql, params } = grabadora.consultas[0];
    expect(params).toContain("%lampara%");
    expect(params).toContain("%led%");
    expect(params).not.toContain("%lámparas led%");
    expect(sql.match(/\) LIKE \$/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toContain("word_similarity");
  });

  it("con búsqueda ordena por relevancia (y desempata por nombre)", async () => {
    await getCatalogo({ soloVisibles: false, busqueda: "foco" });
    const { sql } = grabadora.consultas[0];
    const orden = sql.slice(sql.indexOf(" order by "));
    expect(orden).toMatch(/^ order by \(case when /);
    expect(orden).toContain("then 4 when");
    expect(orden).toContain("then 20 else 0 end");
    expect(orden).toMatch(/ desc, "catalog_products_shop"\."name" asc$/);
  });

  it("la búsqueda tolerante suma el parecido por trigramas, calificado en public", async () => {
    await getCatalogo({ soloVisibles: false, busqueda: "lampra", tolerante: true });
    const { sql } = grabadora.consultas[0];
    const total = sql.match(/word_similarity\(/g)?.length ?? 0;
    const calificadas = sql.match(/public\.word_similarity\(/g)?.length ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(calificadas).toBe(total);
  });

  it("sin términos útiles no filtra por texto", async () => {
    await getCatalogo({ soloVisibles: false, busqueda: " ,, " });
    const { sql } = grabadora.consultas[0];
    expect(sql).not.toContain(" LIKE ");
  });
});
