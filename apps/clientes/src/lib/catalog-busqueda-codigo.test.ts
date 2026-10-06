import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Etapa de código del motor (`texto.codigo`): el código se compara SIN separadores (`DL18W`
 * encuentra `DL-18W`), con el exacto y el que empieza con el código arriba, y el parecido por
 * trigramas sobre el código sólo en el segundo intento (`texto.tolerante`). Sin base: `dbGrabadora`
 * anota SQL y parámetros. Los valores viajan SIEMPRE como parámetros.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getPaginaCatalogo, type FiltrosCatalogo } from "./catalog";

const conConteo = (c: ConsultaGrabada) => (c.sql.startsWith("select count(*)::int") ? [[1]] : undefined);

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});
afterEach(() => vi.unstubAllEnvs());

async function leer(filtros: FiltrosCatalogo, orden: "relevancia" | "nombre" = "relevancia") {
  await getPaginaCatalogo({ soloVisibles: false, filtros, orden });
  const [conteo, filas] = sinLecturaDelArbol(grabadora.consultas);
  return { conteo, filas };
}

const SIN_SEPARADORES = /regexp_replace\([\s\S]*?,\s*'\[\^a-z0-9\]',\s*'',\s*'g'\)/;

describe("texto.codigo: SQL", () => {
  it("compara el código sin separadores (LIKE) y conserva el AND clásico de términos como alternativa", async () => {
    const { conteo, filas } = await leer({ texto: { q: "DL-18W", codigo: true } });
    for (const { sql, params } of [conteo, filas]) {
      expect(sql).toMatch(SIN_SEPARADORES);
      expect(params).toContain("%dl18w%");
      expect(params).toContain("%dl-18w%");
    }
  });

  it("DL18W, DL-18W y «dl 18 w» arman la misma condición de código (mismo código normalizado)", async () => {
    for (const q of ["DL18W", "DL-18W", "dl 18 w"]) {
      grabadora = dbGrabadora(conConteo);
      const { conteo } = await leer({ texto: { q, codigo: true } });
      expect(conteo.params).toContain("%dl18w%");
    }
  });

  it("el orden: relevancia clásica + código normalizado exacto (+20) + empieza con el código (+12)", async () => {
    const { filas } = await leer({ texto: { q: "DL-18W", codigo: true } });
    const orden = filas.sql.slice(filas.sql.indexOf("order by"));
    expect(orden).toMatch(SIN_SEPARADORES);
    expect(orden).toMatch(/then 20/);
    expect(orden).toMatch(/then 12/);
    expect(filas.params).toContain("dl18w");
    expect(filas.params).toContain("dl18w%");
  });

  it("los valores van sólo en parámetros, nunca dentro del texto del SQL", async () => {
    const { conteo, filas } = await leer({ texto: { q: "DL-18W", codigo: true } });
    for (const { sql } of [conteo, filas]) {
      expect(sql.toLowerCase()).not.toContain("dl18w");
      expect(sql.toLowerCase()).not.toContain("dl-18w");
    }
  });

  it("sin tolerante, no hay parecido por trigramas sobre el código (el trigrama es sólo del segundo intento)", async () => {
    const { conteo, filas } = await leer({ texto: { q: "DL-18W", codigo: true } });
    expect(conteo.sql).not.toContain("word_similarity");
    expect(filas.sql).not.toContain("word_similarity");
  });

  it("tolerante + código: suma word_similarity(código normalizado, código sin separadores) >= umbral 0.6, calificado con public", async () => {
    const { conteo } = await leer({ texto: { q: "DL-18W", codigo: true, tolerante: true } });
    expect(conteo.sql).toContain("public.word_similarity(");
    expect(conteo.sql).toMatch(new RegExp(`word_similarity\\(\\$\\d+, ${SIN_SEPARADORES.source}\\) >= \\$\\d+`));
    expect(conteo.params).toContain("dl18w");
    expect(conteo.params).toContain(0.6);
    // Y sigue el LIKE por contiene de la etapa de código.
    expect(conteo.params).toContain("%dl18w%");
  });

  it("tolerante + código de 3 caracteres: no hay trigrama sobre el código (sólo desde 4)", async () => {
    const { conteo } = await leer({ texto: { q: "e27", codigo: true, tolerante: true } });
    expect(conteo.sql).not.toContain("word_similarity");
    expect(conteo.params).toContain("%e27%");
  });

  it("un código de menos de 3 caracteres no activa la etapa: queda la búsqueda clásica", async () => {
    const { conteo, filas } = await leer({ texto: { q: "e2", codigo: true } });
    expect(conteo.sql).not.toMatch(SIN_SEPARADORES);
    expect(filas.sql).not.toContain(", '[^a-z0-9]'");
    expect(conteo.params).toContain("%e2%");
  });

  it("sin `codigo`, el SQL es el clásico de siempre (sin regexp_replace de código)", async () => {
    const { conteo, filas } = await leer({ texto: { q: "DL-18W" } });
    expect(conteo.sql).not.toMatch(SIN_SEPARADORES);
    expect(filas.sql).not.toMatch(SIN_SEPARADORES);
  });

  it("los demás filtros siguen aplicando junto con el código (marcas, stock)", async () => {
    const { conteo } = await leer({ texto: { q: "DL-18W", codigo: true }, marcas: ["Marca X"], soloStock: true });
    expect(conteo.params).toContain("Marca X");
  });
});
