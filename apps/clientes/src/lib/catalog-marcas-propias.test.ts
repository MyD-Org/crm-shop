import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Filtros de las páginas de marca (spec 2026-10-20-marcas-tienda-oficial §1 y §5):
 * `marcasPropias` compara contra la marca cruda SIN el corte de `mostrar_marca`
 * (ese flag decide si se muestra la marca en la card, no si el producto es de la
 * marca) y `linea` une categorías y códigos. Sin base: `dbGrabadora` anota el SQL.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getPaginaCatalogo, getValoresMarca, type FiltrosCatalogo } from "./catalog";

const conConteo = (c: ConsultaGrabada) => (c.sql.startsWith("select count(*)::int") ? [[1]] : undefined);

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});
afterEach(() => vi.unstubAllEnvs());

/** La consulta principal (la de los productos) para unos filtros. */
async function principal(filtros: FiltrosCatalogo): Promise<ConsultaGrabada> {
  grabadora = dbGrabadora(conConteo);
  await getPaginaCatalogo({ soloVisibles: true, filtros, orden: "destacados" });
  const consultas = sinLecturaDelArbol(grabadora.consultas);
  return consultas.find((c) => !c.sql.startsWith("select count(*)::int")) ?? consultas[0];
}

/** Lo que va después del `where` (el `select` sí lee `mostrar_marca` para la card). */
const whereDe = (c: ConsultaGrabada) => c.sql.slice(c.sql.indexOf(" where "));

const CONDICION_STOCK = / end\) > 0\)/;

describe("marcasPropias", () => {
  it("marcasPropias ignora mostrar_marca", async () => {
    const c = await principal({ marcasPropias: ["LED PREMIUM", "Led Premium"] });
    const where = whereDe(c);
    expect(where).toMatch(/coalesce\(nullif\([^)]*"brand"[^)]*\)[^)]*\) in \(/);
    expect(where).not.toMatch(/mostrar_marca/);
    expect(c.params).toEqual(expect.arrayContaining(["LED PREMIUM", "Led Premium"]));
  });

  it("sin soloStock no hay condición de stock (la línea completa)", async () => {
    expect(whereDe(await principal({ marcasPropias: ["ACME"] }))).not.toMatch(CONDICION_STOCK);
    expect(whereDe(await principal({ marcasPropias: ["ACME"], soloStock: true }))).toMatch(CONDICION_STOCK);
  });
});

describe("linea", () => {
  it("linea une categorías y skus", async () => {
    const c = await principal({ marcasPropias: ["ACME"], linea: { categorias: ["Piscinas"], skus: [" ab-1 "] } });
    const where = whereDe(c);
    expect(where).toMatch(/ or /);
    expect(where).toMatch(/upper\(btrim\(/);
    expect(c.params).toEqual(expect.arrayContaining(["Piscinas", "AB-1"]));
  });

  it("una línea vacía no filtra", async () => {
    const sola = await principal({ marcasPropias: ["ACME"] });
    const vacia = await principal({ marcasPropias: ["ACME"], linea: { categorias: [], skus: [] } });
    expect(vacia.sql).toBe(sola.sql);
  });

  it("una línea solo de códigos no consulta el árbol de categorías por nombre", async () => {
    const c = await principal({ linea: { categorias: [], skus: ["X1"] } });
    expect(whereDe(c)).toMatch(/upper\(btrim\(/);
    expect(c.params).toContain("X1");
  });
});

describe("getValoresMarca", () => {
  it("agrupa por la marca cruda, sin stock ni mostrar_marca", async () => {
    grabadora = dbGrabadora(() => [["ACME", 3]]);
    await getValoresMarca(true);
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/group by/);
    expect(c.sql).toMatch(/coalesce\(nullif\(/);
    expect(whereDe(c)).not.toMatch(CONDICION_STOCK);
    expect(c.sql).not.toMatch(/mostrar_marca/);
  });
});
