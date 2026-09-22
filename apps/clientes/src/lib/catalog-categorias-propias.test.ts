import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, esLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Categorías propias del CRM en la tienda: el árbol que llega por la sync del
 * overlay manda sobre las categorías de Alegra en el menú, las facetas y el
 * filtro. Sin árbol (sync nunca corrida), todo sigue como antes.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { enArbolConConteo, getCategorias, getFacetas, getPaginaCatalogo } from "./catalog";

const ILUMINACION = "11111111-1111-4111-8111-111111111111";
const FOCOS = "22222222-2222-4222-8222-222222222222";
const TIRAS = "33333333-3333-4333-8333-333333333333";
const ELECTRICIDAD = "44444444-4444-4444-8444-444444444444";
const SEGURIDAD = "55555555-5555-4555-8555-555555555555";

/** Filas del árbol en el orden de columnas de la consulta: id, parentId, nombre, orden. */
const ARBOL: unknown[][] = [
  [ELECTRICIDAD, null, "ELECTRICIDAD", 1],
  [ILUMINACION, null, "ILUMINACION", 0],
  [FOCOS, ILUMINACION, "Focos led", 0],
  [TIRAS, ILUMINACION, "Tiras led", 1],
  [SEGURIDAD, null, "SEGURIDAD", 2],
];

const esConteoPorCategoria = (c: ConsultaGrabada) => c.sql.includes('group by "public"."catalog_overlay"."categoria_id"');

/** Árbol cargado; productos: 3 directos en ILUMINACION, 2 en Focos led, 4 en ELECTRICIDAD. */
function conArbol() {
  return dbGrabadora((c) => {
    if (esLecturaDelArbol(c)) return ARBOL;
    if (esConteoPorCategoria(c)) return [[ILUMINACION, 3], [FOCOS, 2], [ELECTRICIDAD, 4]];
    if (c.sql.includes("count(*)")) return [[1]];
    return [];
  });
}

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora((c) => (c.sql.includes("count(*)") ? [[1]] : []));
});

describe("enArbolConConteo", () => {
  const nodos = ARBOL.map(([id, parentId, nombre, orden]) => ({
    id: id as string,
    parentId: parentId as string | null,
    nombre: nombre as string,
    orden: orden as number,
  }));

  it("suma cada producto en su categoría y en todas las que la contienen", () => {
    const r = enArbolConConteo(nodos, new Map([[FOCOS, 2], [ILUMINACION, 3]]));
    expect(r).toEqual([
      { label: "ILUMINACION", count: 5, nivel: 1 },
      { label: "Focos led", count: 2, nivel: 2 },
    ]);
  });

  it("respeta el orden del CRM y pone cada rama completa antes de la siguiente", () => {
    const r = enArbolConConteo(nodos, new Map([[ELECTRICIDAD, 1], [TIRAS, 1], [FOCOS, 1], [SEGURIDAD, 1]]));
    expect(r.map((f) => f.label)).toEqual(["ILUMINACION", "Focos led", "Tiras led", "ELECTRICIDAD", "SEGURIDAD"]);
  });

  it("una categoría sin productos no aparece", () => {
    const r = enArbolConConteo(nodos, new Map([[ELECTRICIDAD, 1]]));
    expect(r.map((f) => f.label)).toEqual(["ELECTRICIDAD"]);
  });

  it("lo que cuelga de una categoría inactiva (fuera del árbol) no se muestra", () => {
    const sinIluminacion = nodos.filter((n) => n.id !== ILUMINACION);
    const r = enArbolConConteo(sinIluminacion, new Map([[FOCOS, 2]]));
    expect(r).toEqual([]);
  });
});

describe("filtro por categoría", () => {
  it("con árbol, busca en el subárbol de la categoría por la clasificación del CRM", async () => {
    await getPaginaCatalogo({ filtros: { categorias: ["ILUMINACION"] } });
    for (const { sql, params } of grabadora.consultas) {
      expect(sql).toContain("with recursive arbol");
      expect(sql).toContain('"public"."catalog_overlay"."categoria_id" in');
      expect(params).toContain("ILUMINACION");
      expect(params).toContain("tenant-test");
    }
  });

  it("sin árbol cae a la categoría de Alegra, en la misma consulta", async () => {
    await getPaginaCatalogo({ filtros: { categorias: ["ILUMINACION"] } });
    for (const { sql } of grabadora.consultas) {
      expect(sql).toMatch(/not exists \(select 1 from "public"\."shop_categories" where activa and tenant_id = \$\d+\)/);
      expect(sql).toContain('"shop"."catalog_categories"."name" in');
    }
  });
});

describe("facetas de categorías", () => {
  it("con árbol, salen del árbol con los conteos sumados y el nivel", async () => {
    grabadora = conArbol();
    const { categorias } = await getFacetas({});
    expect(categorias).toEqual([
      { label: "ILUMINACION", count: 5, nivel: 1 },
      { label: "Focos led", count: 2, nivel: 2 },
      { label: "ELECTRICIDAD", count: 4, nivel: 1 },
    ]);
    expect(grabadora.consultas.some((c) => c.sql.includes('group by "shop"."catalog_categories"."name"'))).toBe(false);
  });

  it("sin árbol, siguen agrupando por la categoría de Alegra", async () => {
    await getFacetas({});
    expect(grabadora.consultas.some((c) => c.sql.includes('group by "shop"."catalog_categories"."name"'))).toBe(true);
    expect(grabadora.consultas.some(esConteoPorCategoria)).toBe(false);
  });
});

describe("menú (getCategorias)", () => {
  it("con árbol, sólo las raíces con productos, en el orden del CRM", async () => {
    grabadora = conArbol();
    expect(await getCategorias()).toEqual(["ILUMINACION", "ELECTRICIDAD"]);
  });

  it("con árbol, cuenta con el mismo criterio que la grilla (activos y con precio)", async () => {
    grabadora = conArbol();
    await getCategorias();
    const conteo = grabadora.consultas.find(esConteoPorCategoria);
    expect(conteo?.sql).toContain('"shop"."catalog_products"."status" = $');
    expect(conteo?.sql).toMatch(/coalesce\(\s*case when jsonb_typeof[\s\S]*?\)\s*>\s*0/);
  });
});
