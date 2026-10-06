import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Texto único de la búsqueda (`FiltrosCatalogo.texto`): la ÚNICA forma de pedirle texto al catálogo
 * (los campos `busqueda`, `busquedaTolerante` y `planBusqueda` y el shim que los traducía se
 * retiraron). Sin base: `dbGrabadora` anota SQL y parámetros.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getPaginaCatalogo, type FiltrosCatalogo } from "./catalog";
import type { CriterioPlan } from "./busqueda-v2/piezas";

const conConteo = (c: ConsultaGrabada) => (c.sql.startsWith("select count(*)::int") ? [[1]] : undefined);

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});
afterEach(() => vi.unstubAllEnvs());

const plan: CriterioPlan = {
  consulta: "foco calido",
  blandos: {
    categorias: [{ nombre: "Bulbos", peso: 0.9 }],
    atributos: [],
    terminos: [
      { texto: "foco", peso: 1 },
      { texto: "lampara", peso: 0.7 },
    ],
  },
};

/** Las consultas de la página para unos filtros (sin las lecturas del árbol de categorías). */
async function sqlDe(filtros: FiltrosCatalogo) {
  grabadora = dbGrabadora(conConteo);
  await getPaginaCatalogo({ soloVisibles: true, filtros, orden: "relevancia" });
  return sinLecturaDelArbol(grabadora.consultas);
}

describe("texto único: forma de pedirle texto al catálogo", () => {
  it("los campos de texto viejos ya no existen (ni el shim que los traducía)", () => {
    // @ts-expect-error `busqueda` se retiró: el texto va en `texto.q`.
    const viejoBusqueda: FiltrosCatalogo = { busqueda: "foco" };
    // @ts-expect-error `busquedaTolerante` se retiró: va en `texto.tolerante`.
    const viejoTolerante: FiltrosCatalogo = { busquedaTolerante: true };
    // @ts-expect-error `planBusqueda` se retiró: va en `texto.plan`.
    const viejoPlan: FiltrosCatalogo = { planBusqueda: plan };
    expect([viejoBusqueda, viejoTolerante, viejoPlan]).toHaveLength(3);
  });

  it("`q` se recorta: con espacios o sin ellos, la misma consulta", async () => {
    const recortada = await sqlDe({ texto: { q: "foco led" } });
    expect(await sqlDe({ texto: { q: "  foco led  " } })).toEqual(recortada);
  });

  it("sin texto (o con q vacía) no hay condición de texto: el SQL es el del filtro solo", async () => {
    const sinTexto = await sqlDe({ categorias: ["Lámparas"] });
    expect(await sqlDe({ categorias: ["Lámparas"], texto: { q: "   " } })).toEqual(sinTexto);
    const conTexto = await sqlDe({ categorias: ["Lámparas"], texto: { q: "foco led" } });
    expect(conTexto).not.toEqual(sinTexto);
    expect(conTexto.some((c) => c.params.some((p) => typeof p === "string" && p.includes("foco")))).toBe(true);
    expect(sinTexto.some((c) => c.params.some((p) => typeof p === "string" && p.includes("foco")))).toBe(false);
  });

  it("cada forma del texto (exacta, plan, tolerante) emite su propia consulta", async () => {
    const exacta = await sqlDe({ texto: { q: "foco calido" } });
    const conPlan = await sqlDe({ texto: { q: "foco calido", plan }, categorias: ["Lámparas"] });
    const tolerante = await sqlDe({ texto: { q: "foco calido", tolerante: true } });
    expect(conPlan).not.toEqual(exacta);
    expect(tolerante).not.toEqual(exacta);
    expect(tolerante.some((c) => c.sql.includes("word_similarity"))).toBe(true);
    expect(exacta.some((c) => c.sql.includes("word_similarity"))).toBe(false);
  });
});

describe("getPaginaCatalogo con sinConteo", () => {
  it("no emite count(*), devuelve total = filas.length, pagina 1 y totalExacto false", async () => {
    const r = await getPaginaCatalogo({
      soloVisibles: false,
      filtros: { texto: { q: "foco" } },
      orden: "relevancia",
      porPagina: 8,
      pagina: 3,
      sinConteo: true,
    });
    expect(grabadora.consultas.some((c) => c.sql.startsWith("select count(*)::int"))).toBe(false);
    expect(grabadora.consultas).toHaveLength(1);
    expect(r).toMatchObject({ total: r.productos.length, pagina: 1, paginas: 1, totalExacto: false });
    // Sin conteo no hay "última página": siempre desde el principio.
    expect(grabadora.consultas[0].params).toContain(8);
    expect(grabadora.consultas[0].params).not.toContain(16);
  });

  it("sin la opción, el comportamiento de siempre y totalExacto true", async () => {
    const r = await getPaginaCatalogo({ soloVisibles: false, filtros: { texto: { q: "foco" } }, orden: "relevancia" });
    expect(grabadora.consultas.some((c) => c.sql.startsWith("select count(*)::int"))).toBe(true);
    expect(r.totalExacto).toBe(true);
    expect(r.total).toBe(1);
  });
});
