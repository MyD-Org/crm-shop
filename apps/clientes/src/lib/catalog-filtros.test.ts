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
const STOCK = /"stock" is null or .*"stock" > 0/;
const cuenta = (sql: string, re: RegExp) => sql.match(re)?.length ?? 0;

/** Separa las tres consultas de `getFacetas` por lo que agrupan/calculan. */
function facetas(consultas: ConsultaGrabada[]) {
  const buscar = (pred: (sql: string) => boolean) => {
    const c = consultas.find((c) => pred(c.sql));
    if (!c) throw new Error("consulta no encontrada");
    return c;
  };
  return {
    categorias: buscar((s) => s.includes('group by "shop"."catalog_categories"."name"')),
    marcas: buscar((s) => s.includes("group by coalesce(nullif(")),
    precio: buscar((s) => s.includes("floor(min(")),
  };
}

describe("filtro por rango de precio (SQL-1)", () => {
  it("con mínimo y máximo, el conteo y la página comparan el precio exhibido con los dos", async () => {
    await getPaginaCatalogo({ filtros: { precioMin: 500, precioMax: 50000 } });
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
    await getPaginaCatalogo({ filtros: { precioMin: 1000 } });
    for (const { sql, params } of grabadora.consultas) {
      expect(cuenta(sql, PRECIO_MINIMO)).toBe(1);
      expect(cuenta(sql, PRECIO_MAXIMO)).toBe(0);
      expect(params).toContain(1000);
    }
  });

  it("sin filtros nuevos, el WHERE no menciona stock ni rango (misma forma que hoy)", async () => {
    await getPaginaCatalogo({ filtros: { categorias: ["ILUMINACION"] } });
    for (const { sql } of grabadora.consultas) {
      expect(sql).not.toMatch(STOCK);
      expect(cuenta(sql, PRECIO_MINIMO)).toBe(0);
      expect(cuenta(sql, PRECIO_MAXIMO)).toBe(0);
    }
  });
});

describe('filtro "solo con stock" (SQL-1)', () => {
  it("exige stock nulo (no inventariable) o positivo", async () => {
    await getPaginaCatalogo({ filtros: { soloStock: true } });
    expect(grabadora.consultas).toHaveLength(2);
    for (const { sql } of grabadora.consultas) expect(sql).toMatch(STOCK);
  });

  it("con la simulación de stock activa, el predicado no aparece", async () => {
    // Con la simulación todo se muestra disponible: filtrar por stock > 0
    // escondería productos que la card dice que están.
    vi.stubEnv("SHOP_STOCK_SIMULADO", "1");
    vi.stubEnv("VERCEL_ENV", "");
    await getPaginaCatalogo({ filtros: { soloStock: true } });
    for (const { sql } of grabadora.consultas) expect(sql).not.toMatch(STOCK);
  });

  it("el estado por defecto de la URL (sin parámetros) filtra por stock", async () => {
    await getPaginaCatalogo({ filtros: filtrosDeEstado(leerEstado({})) });
    expect(grabadora.consultas).toHaveLength(2);
    for (const { sql } of grabadora.consultas) expect(sql).toMatch(STOCK);
  });

  it("el estado por defecto no filtra por stock con la simulación activa", async () => {
    vi.stubEnv("SHOP_STOCK_SIMULADO", "1");
    vi.stubEnv("VERCEL_ENV", "");
    await getPaginaCatalogo({ filtros: filtrosDeEstado(leerEstado({})) });
    for (const { sql } of grabadora.consultas) expect(sql).not.toMatch(STOCK);
  });

  it("incluir sin stock no agrega el predicado", async () => {
    await getPaginaCatalogo({
      filtros: filtrosDeEstado(leerEstado({ stock: STOCK_INCLUYE_SIN_STOCK })),
    });
    for (const { sql } of grabadora.consultas) expect(sql).not.toMatch(STOCK);
  });
});

describe("facetas con precio y stock (SQL-2, SQL-3)", () => {
  it("son tres consultas: categorías, marcas y rango de precio", async () => {
    await getFacetas({});
    expect(sinLecturaDelArbol(grabadora.consultas)).toHaveLength(3);
    const { categorias, marcas, precio } = facetas(grabadora.consultas);
    expect(categorias.sql).toContain('"shop"."catalog_categories"."name"');
    expect(marcas.sql).toContain('coalesce(nullif("shop"."catalog_products"."brand"');
    expect(precio.sql).toMatch(/floor\(min\([\s\S]*\/ 100\)\)\)::int/);
    expect(precio.sql).toMatch(/ceil\(max\([\s\S]*\/ 100\)\)\)::int/);
  });

  it("cada grupo aplica el rango de precio salvo el propio rango", async () => {
    await getFacetas({ precioMin: 500, marcas: ["X"] });
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
    await getFacetas({ soloStock: true, marcas: ["GENROD"] });
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
    const { precio } = await getFacetas({});
    expect(precio).toEqual({ min: 500, max: 50000 });
  });

  it("sin productos que cumplan, el rango es null", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.includes("floor(min(") ? [[null, null]] : undefined
    );
    expect((await getFacetas({})).precio).toBeNull();

    grabadora = dbGrabadora(() => []);
    expect((await getFacetas({})).precio).toBeNull();
  });
});

describe("orden por defecto (SQL-5)", () => {
  it("sin orden explícito ordena sólo por nombre", async () => {
    await getPaginaCatalogo({});
    const pagina = grabadora.consultas[1];
    expect(pagina.sql).toMatch(/order by "shop"\."catalog_products"\."name" asc limit/);
  });

  it("por precio conserva el desempate por nombre", async () => {
    await getPaginaCatalogo({ orden: "precio-asc" });
    const pagina = grabadora.consultas[1];
    expect(pagina.sql).toMatch(/\/ 100\) asc, "shop"\."catalog_products"\."name" asc limit/);
  });

  it('ninguna consulta menciona "ventas"', async () => {
    await getPaginaCatalogo({});
    await getFacetas({});
    for (const { sql, params } of grabadora.consultas) {
      expect(sql).not.toContain("ventas");
      expect(params).not.toContain("ventas");
    }
  });
});
