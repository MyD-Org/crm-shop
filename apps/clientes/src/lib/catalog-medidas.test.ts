import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Forma del SQL de las medidas (ids dinámicos de atributo `corriente_a:20`) en las consultas reales
 * del catálogo, sin base: en el filtro, "sin contradicción" (NOT EXISTS) si el universo está
 * acotado y "positivo" si no; el boost y la recuperación siempre en positivo; sin datos
 * estructurados no restringen; el valor sólo viaja como parámetro.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getFacetas, getPaginaCatalogo, contarCatalogo } from "./catalog";
import { filtrosCacheables } from "./catalogo-publico";
import type { CriterioPlan } from "./busqueda-v2/piezas";

const conConteo = (c: ConsultaGrabada) => (c.sql.startsWith("select count(*)::int") ? [[1]] : undefined);

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});
afterEach(() => vi.unstubAllEnvs());

const TABLA = '"public"."catalog_atributos"';
const NOT_EXISTS = /not exists \(select 1 from "public"\."catalog_atributos"/g;
const cuenta = (sql: string, re: RegExp) => sql.match(re)?.length ?? 0;
const conteo = () => grabadora.consultas[0];

const pagina = (filtros: Parameters<typeof getPaginaCatalogo>[0]["filtros"]) =>
  getPaginaCatalogo({ soloVisibles: false, filtros: { atributosEstructurados: true, ...filtros } });

describe("filtro por una medida dinámica", () => {
  it("con categoría dura: sin contradicción (NOT EXISTS); el valor solo en params (R4.2)", async () => {
    await pagina({ categorias: ["Termomagnéticas"], atributos: ["corriente_a:20"] });
    for (const { sql, params } of grabadora.consultas) {
      expect(cuenta(sql, NOT_EXISTS)).toBe(1);
      expect(sql).toMatch(/not coalesce\(/);
      expect(params).toEqual(expect.arrayContaining(["corriente_a", 20]));
      expect(sql).not.toMatch(/[^$\d]20[^\d]/);
    }
  });

  it("con búsqueda clásica: sin contradicción", async () => {
    await pagina({ texto: { q: "termica" }, atributos: ["polos:2"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(1);
  });

  it("sin categoría ni búsqueda (?atr=corriente_a:20 a mano): positivo, solo los que cumplen", async () => {
    await pagina({ atributos: ["corriente_a:20"] });
    const { sql, params } = conteo();
    expect(cuenta(sql, NOT_EXISTS)).toBe(0);
    // dato estructurado O patrón del nombre
    expect(sql).toContain(TABLA);
    expect(sql).toMatch(/\) or "shop"\.immutable_unaccent\(lower\(concat_ws\([\s\S]*?\)\)\) ~\* \$\d+\)/);
    expect(params).toEqual(expect.arrayContaining(["corriente_a", 20]));
    expect(params.some((p) => typeof p === "string" && p.includes("20 ?(a|amp"))).toBe(true);
  });

  it("con plan: los términos que recuperan acotan; si no hay ninguno (solo medidas), positivo", async () => {
    const plan = (terminos: { texto: string; peso: number }[]): CriterioPlan => ({
      consulta: "bipolar 20a",
      blandos: { categorias: [], atributos: [], terminos },
    });
    await pagina({ texto: { q: "bipolar 20a", plan: plan([{ texto: "20a", peso: 0.4 }]) }, atributos: ["polos:2", "corriente_a:20"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(0);
    grabadora = dbGrabadora(conConteo);
    await pagina({ texto: { q: "termica 20a", plan: plan([{ texto: "termica", peso: 1 }]) }, atributos: ["polos:2", "corriente_a:20"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(2);
  });

  it("en cualquier etapa el texto acota el universo (la de código y la tolerante también): sin contradicción", async () => {
    await pagina({ texto: { q: "DL-18W", codigo: true }, atributos: ["polos:2"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(1);
    grabadora = dbGrabadora(conConteo);
    await pagina({ texto: { q: "termica", tolerante: true }, atributos: ["polos:2"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(1);
    grabadora = dbGrabadora(conConteo);
    await pagina({ texto: { q: "   " }, atributos: ["polos:2"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(0);
  });

  it("`medidasPositivas` fuerza el modo (lo usa el conteo de positivos)", async () => {
    await pagina({ categorias: ["Termomagnéticas"], atributos: ["corriente_a:20"], medidasPositivas: true });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(0);
    grabadora = dbGrabadora(conConteo);
    await pagina({ atributos: ["corriente_a:20"], medidasPositivas: false });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(1);
  });

  it("los ids del diccionario no cambian con el modo (patrón O estructurado, sin NOT EXISTS)", async () => {
    await pagina({ categorias: ["Iluminación"], atributos: ["zocalo-e27"] });
    const a = conteo();
    grabadora = dbGrabadora(conConteo);
    await pagina({ atributos: ["zocalo-e27"], medidasPositivas: true });
    expect(cuenta(a.sql, NOT_EXISTS)).toBe(0);
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(0);
  });

  it("sin datos estructurados no restringen y no nombran la tabla", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { atributos: ["corriente_a:20", "polos:2"], categorias: ["X"] } });
    for (const { sql } of grabadora.consultas) expect(sql).not.toContain("catalog_atributos");
  });

  it("OR dentro del mismo grupo y AND entre grupos", async () => {
    await pagina({ categorias: ["X"], atributos: ["corriente_a:20", "corriente_a:25", "polos:2"] });
    expect(cuenta(conteo().sql, NOT_EXISTS)).toBe(3);
  });

  it("ids inválidos (inyección) no llegan al SQL", async () => {
    await pagina({ categorias: ["X"], atributos: ["corriente_a:20' OR 1=1--", "polos:9"] });
    for (const { sql, params } of grabadora.consultas) {
      expect(cuenta(sql, NOT_EXISTS)).toBe(0);
      expect(params.some((p) => typeof p === "string" && p.includes("OR 1=1"))).toBe(false);
    }
  });
});

describe("filtro conClaves (cobertura de una clave en el universo)", () => {
  it("una fila de la clave con cualquier valor, una por clave, la clave como parámetro", async () => {
    await contarCatalogo({ soloVisibles: false, filtros: { atributosEstructurados: true, categorias: ["X"], conClaves: ["polos", "corriente_a"] } });
    const { sql, params } = conteo();
    expect(sql).toContain(TABLA);
    expect(params).toEqual(expect.arrayContaining(["polos", "corriente_a"]));
    expect(cuenta(sql, /exists \(select 1 from "public"\."catalog_atributos"/g)).toBe(2);
    expect(cuenta(sql, NOT_EXISTS)).toBe(0);
  });

  it("sin datos estructurados no filtra", async () => {
    await contarCatalogo({ soloVisibles: false, filtros: { categorias: ["X"], conClaves: ["polos"] } });
    expect(conteo().sql).not.toContain("catalog_atributos");
  });
});

describe("boost y recuperación (siempre en positivo)", () => {
  const plan: CriterioPlan = {
    consulta: "termica 2x20",
    blandos: { categorias: [], atributos: [{ id: "corriente_a:20", peso: 1 }], terminos: [] },
  };

  it("el orden por relevancia suma el positivo (dato o patrón) aunque el filtro sea sin contradicción", async () => {
    await getPaginaCatalogo({
      soloVisibles: false,
      orden: "relevancia",
      filtros: { atributosEstructurados: true, categorias: ["Termomagnéticas"], texto: { q: "", plan }, atributos: ["polos:2"] },
    });
    const filas = grabadora.consultas[1];
    const order = filas.sql.slice(filas.sql.indexOf("order by"));
    expect(order).toContain(TABLA);
    expect(order).toContain("~*");
    expect(order).not.toContain("not exists");
    expect(filas.params.some((p) => typeof p === "string" && p.includes("20 ?(a|amp"))).toBe(true);
  });
});

describe("facetas con una medida activa", () => {
  it("las demás facetas cuentan sin contradicción y no hay faceta propia de las medidas", async () => {
    const f = await getFacetas({ atributosEstructurados: true, categorias: ["X"], atributos: ["corriente_a:20"] }, false);
    const consultas = sinLecturaDelArbol(grabadora.consultas);
    const marcas = consultas.find((c) => c.sql.includes("group by (case when"))!;
    expect(cuenta(marcas.sql, NOT_EXISTS)).toBe(1);
    const atributos = consultas.find((c) => c.sql.includes("count(*) filter"))!;
    expect(atributos.sql).toMatch(/not \(\(\("filas_atributos"\."attrs" -> 'corriente_a'\) ->> 'n'\)::numeric is not null/);
    expect(atributos.params).toContain(20);
    expect(f.atributos.every((a) => !a.label.includes(":"))).toBe(true);
  });

  it("sin categoría ni búsqueda, las facetas cuentan en positivo igual que la página", async () => {
    await getFacetas({ atributosEstructurados: true, atributos: ["corriente_a:20"] }, false);
    const marcas = sinLecturaDelArbol(grabadora.consultas).find((c) => c.sql.includes("group by (case when"))!;
    expect(cuenta(marcas.sql, NOT_EXISTS)).toBe(0);
    expect(marcas.sql).toContain(TABLA);
  });
});

describe("caché del catálogo público", () => {
  it("una medida en la URL no se cachea (tantas claves como valores posibles)", () => {
    expect(filtrosCacheables({ atributos: ["corriente_a:20"] })).toBe(false);
    expect(filtrosCacheables({ atributos: ["tono-calido", "polos:2"] })).toBe(false);
    expect(filtrosCacheables({ atributos: ["tono-calido"] })).toBe(true);
    expect(filtrosCacheables({ categorias: ["X"] })).toBe(true);
  });
});
