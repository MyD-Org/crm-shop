import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Forma del SQL de los filtros nuevos del catálogo (precio, stock), del rango
 * de precio que alimenta el slider y del orden por defecto. Ejecuta las
 * funciones reales contra un cliente que sólo anota el SQL: no hay base.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getFacetas, getPaginaCatalogo } from "./catalog";
import { STOCK_INCLUYE_SIN_STOCK, filtrosDeEstado, leerEstado } from "./catalogo-url";
import { ATRIBUTOS } from "./catalogo-atributos";

/** count(*) = 1 para que la página también dispare la consulta de filas. */
const conConteo = (c: ConsultaGrabada) =>
  c.sql.startsWith("select count(*)::int") ? [[1]] : undefined;

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * El precio exhibido en SQL termina en `* (1 + coalesce(iva, 0) / 100)`; el
 * predicado de rango compara ESA expresión (no el neto) contra un parámetro.
 */
const PRECIO_MINIMO = /\/ 100\) >= \$\d+/g;
const PRECIO_MAXIMO = /\/ 100\) <= \$\d+/g;
// Disponible: stock de la vista del CRM menos lo reservado por pedidos vivos
// (ver stock-disponible.ts).
const STOCK = /coalesce\("stock_reservado"\."qty", 0\)\) end\) is null or \(case when .*coalesce\("stock_reservado"\."qty", 0\)\) end\) > 0/;
const cuenta = (sql: string, re: RegExp) => sql.match(re)?.length ?? 0;

/** Separa las tres consultas de `getFacetas` por lo que agrupan/calculan. */
function facetas(consultas: ConsultaGrabada[]) {
  const buscar = (pred: (sql: string) => boolean) => {
    const c = consultas.find((c) => pred(c.sql));
    if (!c) throw new Error("consulta no encontrada");
    return c;
  };
  return {
    categorias: buscar((s) => s.includes('group by "catalog_categories_shop"."name"')),
    marcas: buscar((s) => s.includes("group by (case when")),
    precio: buscar((s) => s.includes("floor(min(")),
  };
}

describe("filtro por rango de precio (SQL-1)", () => {
  it("con mínimo y máximo, el conteo y la página comparan el precio exhibido con los dos", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { precioMin: 500, precioMax: 50000 } });
    expect(grabadora.consultas).toHaveLength(2);
    for (const { sql, params } of grabadora.consultas) {
      expect(sql).toContain("jsonb_array_elements");
      expect(cuenta(sql, PRECIO_MINIMO)).toBe(1);
      expect(cuenta(sql, PRECIO_MAXIMO)).toBe(1);
      expect(params).toContain(500);
      expect(params).toContain(50000);
    }
  });

  it("sólo con mínimo, hay una sola comparación (>=) y ninguna <=", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { precioMin: 1000 } });
    for (const { sql, params } of grabadora.consultas) {
      expect(cuenta(sql, PRECIO_MINIMO)).toBe(1);
      expect(cuenta(sql, PRECIO_MAXIMO)).toBe(0);
      expect(params).toContain(1000);
    }
  });

  it("sin filtros nuevos, el WHERE no menciona stock ni rango (misma forma que hoy)", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { categorias: ["ILUMINACION"] } });
    for (const { sql } of grabadora.consultas) {
      expect(sql).not.toMatch(STOCK);
      expect(cuenta(sql, PRECIO_MINIMO)).toBe(0);
      expect(cuenta(sql, PRECIO_MAXIMO)).toBe(0);
    }
  });
});

describe('filtro "solo con stock" (SQL-1)', () => {
  it("exige stock nulo (no inventariable) o positivo", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { soloStock: true } });
    expect(grabadora.consultas).toHaveLength(2);
    for (const { sql } of grabadora.consultas) expect(sql).toMatch(STOCK);
  });


  it("el estado por defecto de la URL (sin parámetros) filtra por stock", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: filtrosDeEstado(leerEstado({})) });
    expect(grabadora.consultas).toHaveLength(2);
    for (const { sql } of grabadora.consultas) expect(sql).toMatch(STOCK);
  });


  it("incluir sin stock no agrega el predicado", async () => {
    await getPaginaCatalogo({
      soloVisibles: false,
      filtros: filtrosDeEstado(leerEstado({ stock: STOCK_INCLUYE_SIN_STOCK })),
    });
    for (const { sql } of grabadora.consultas) expect(sql).not.toMatch(STOCK);
  });
});

describe("facetas con precio y stock (SQL-2, SQL-3)", () => {
  it("son cuatro consultas: categorías, marcas, rango de precio y atributos", async () => {
    await getFacetas({}, false);
    expect(sinLecturaDelArbol(grabadora.consultas)).toHaveLength(4);
    const { categorias, marcas, precio } = facetas(grabadora.consultas);
    expect(categorias.sql).toContain('"catalog_categories_shop"."name"');
    // Sin marca en la vista, cuenta bajo el nombre de su categoría de Alegra
    // (p. ej. "Iluminación"), con la categoría del mismo tenant.
    expect(marcas.sql).toContain(
      'group by (case when "public"."catalog_overlay"."mostrar_marca" is false then null\n  else coalesce(nullif("catalog_products_shop"."brand", \'\'), "catalog_categories_shop"."name") end)',
    );
    expect(marcas.sql).toMatch(/"catalog_categories_shop"\."tenant_id" = \$\d+\)/);
    expect(precio.sql).toMatch(/floor\(min\([\s\S]*\/ 100\)\)\)::int/);
    expect(precio.sql).toMatch(/ceil\(max\([\s\S]*\/ 100\)\)\)::int/);
  });

  it("cada grupo aplica el rango de precio salvo el propio rango", async () => {
    await getFacetas({ precioMin: 500, marcas: ["X"] }, false);
    const { categorias, marcas, precio } = facetas(grabadora.consultas);

    expect(cuenta(categorias.sql, PRECIO_MINIMO)).toBe(1);
    expect(categorias.sql).toContain("in ($");
    expect(categorias.params).toContain("X");

    expect(cuenta(marcas.sql, PRECIO_MINIMO)).toBe(1);
    expect(marcas.params).not.toContain("X");

    expect(cuenta(precio.sql, PRECIO_MINIMO)).toBe(0);
    expect(cuenta(precio.sql, PRECIO_MAXIMO)).toBe(0);
    expect(precio.params).toContain("X");
  });

  it("las marcas se cuentan con el stock filtrado y sin el filtro de marcas", async () => {
    await getFacetas({ soloStock: true, marcas: ["GENROD"] }, false);
    const { categorias, marcas, precio } = facetas(grabadora.consultas);
    expect(marcas.sql).toMatch(STOCK);
    expect(marcas.params).not.toContain("GENROD");
    expect(categorias.sql).toMatch(STOCK);
    expect(categorias.params).toContain("GENROD");
    expect(precio.sql).toMatch(STOCK);
  });

  it("devuelve el rango como enteros a partir de la fila min/max", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.includes("floor(min(") ? [[500, 50000]] : undefined
    );
    const { precio } = await getFacetas({}, false);
    expect(precio).toEqual({ min: 500, max: 50000 });
  });

  it("sin productos que cumplan, el rango es null", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.includes("floor(min(") ? [[null, null]] : undefined
    );
    expect((await getFacetas({}, false)).precio).toBeNull();

    grabadora = dbGrabadora(() => []);
    expect((await getFacetas({}, false)).precio).toBeNull();
  });
});

describe("orden por defecto (SQL-5)", () => {
  it("sin orden explícito ordena sólo por nombre", async () => {
    await getPaginaCatalogo({ soloVisibles: false });
    const pagina = grabadora.consultas[1];
    expect(pagina.sql).toMatch(/order by "catalog_products_shop"\."name" asc limit/);
  });

  it("por precio conserva el desempate por nombre", async () => {
    await getPaginaCatalogo({ soloVisibles: false, orden: "precio-asc" });
    const pagina = grabadora.consultas[1];
    expect(pagina.sql).toMatch(/\/ 100\) asc, "catalog_products_shop"\."name" asc limit/);
  });

  it('ninguna consulta menciona "ventas"', async () => {
    await getPaginaCatalogo({ soloVisibles: false });
    await getFacetas({}, false);
    for (const { sql, params } of grabadora.consultas) {
      expect(sql).not.toContain("ventas");
      expect(params).not.toContain("ventas");
    }
  });
});

describe("filtro y facetas de atributos (`atr`)", () => {
  const patron = (id: string) => ATRIBUTOS.find((a) => a.id === id)!.patron;
  const REGEX = /"shop"\.immutable_unaccent\(lower\(concat_ws\(.*?\)\)\) ~\* \$\d+/g;

  it("AND entre grupos, OR dentro del grupo, con el patrón como parámetro", async () => {
    await getPaginaCatalogo({
      soloVisibles: false,
      filtros: { atributos: ["tono-calido", "tono-frio", "apto-exterior"] },
    });
    for (const { sql, params } of grabadora.consultas) {
      expect(cuenta(sql, REGEX)).toBe(3);
      expect(sql).toMatch(/\(.* ~\* \$\d+ or .* ~\* \$\d+\) and .* ~\* \$\d+/);
      expect(params).toContain(patron("tono-calido"));
      expect(params).toContain(patron("tono-frio"));
      expect(params).toContain(patron("apto-exterior"));
    }
  });

  it("ids desconocidos no filtran; sin atributos el WHERE no tiene `~*`", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { atributos: ["inventado"] } });
    await getPaginaCatalogo({ soloVisibles: false, filtros: { categorias: ["ILUMINACION"] } });
    for (const { sql } of grabadora.consultas) expect(sql).not.toContain("~*");
  });

  it("una sola consulta de facetas cuenta cada atributo con los filtros de los OTROS grupos", async () => {
    await getFacetas({ atributos: ["tono-calido", "zocalo-e27"] }, false);
    const atributos = sinLecturaDelArbol(grabadora.consultas).find((c) => c.sql.includes("count(*) filter"));
    expect(atributos).toBeDefined();
    const { sql, params } = atributos!;
    expect(cuenta(sql, /count\(\*\) filter/g)).toBe(ATRIBUTOS.length);
    // El WHERE de la consulta no lleva atributos: sólo los `filter` de cada columna.
    expect(sql.split(" where ").at(-1)).not.toContain("~*");
    // "Luz fría" se cuenta con la rosca E27 aplicada pero sin "Luz cálida".
    const iFrio = params.indexOf(patron("tono-frio"));
    expect(iFrio).toBeGreaterThan(-1);
    expect(params[iFrio - 1]).toBe(patron("zocalo-e27"));
    // Las demás facetas sí filtran por los atributos tildados.
    const marcas = sinLecturaDelArbol(grabadora.consultas).find((c) => c.sql.includes("group by (case when"));
    expect(marcas!.params).toContain(patron("tono-calido"));
  });
});

describe("faceta de atributos con el flag busqueda-ia apagado", () => {
  it("sinFacetaAtributos: no se consulta y sale vacía", async () => {
    const f = await getFacetas({ sinFacetaAtributos: true }, false);
    expect(f.atributos).toEqual([]);
    expect(sinLecturaDelArbol(grabadora.consultas)).toHaveLength(3);
    for (const { sql } of grabadora.consultas) expect(sql).not.toContain("count(*) filter");
  });
});
