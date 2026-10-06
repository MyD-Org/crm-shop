import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Texto único de la búsqueda (`FiltrosCatalogo.texto`): el shim `textoDe` traduce los campos viejos
 * (`busqueda`, `busquedaTolerante`, `planBusqueda`) y, sin cambiar una coma de SQL, ambas formas
 * generan la MISMA consulta. Sin base: `dbGrabadora` anota SQL y parámetros.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { contarCatalogo, getCatalogo, getPaginaCatalogo, textoDe, type FiltrosCatalogo } from "./catalog";
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

describe("textoDe", () => {
  it("traduce los campos viejos al texto único", () => {
    expect(textoDe({ busqueda: "  foco  ", busquedaTolerante: true, planBusqueda: plan })).toEqual({
      q: "foco",
      tolerante: true,
      plan,
    });
    expect(textoDe({ busqueda: "foco" })).toEqual({ q: "foco", tolerante: undefined, plan: undefined });
  });

  it("sin nada, texto vacío", () => {
    expect(textoDe({})).toEqual({ q: "", tolerante: undefined, plan: undefined });
    expect(textoDe({ busqueda: "   " }).q).toBe("");
  });

  it("`texto` explícito gana sobre los campos viejos", () => {
    const t = textoDe({ texto: { q: " panel " }, busqueda: "foco", busquedaTolerante: true, planBusqueda: plan });
    expect(t).toEqual({ q: "panel" });
  });
});

const VARIANTES: { nombre: string; viejos: FiltrosCatalogo; nuevo: FiltrosCatalogo }[] = [
  { nombre: "sólo q", viejos: { busqueda: "foco led" }, nuevo: { texto: { q: "foco led" } } },
  {
    nombre: "q + plan",
    viejos: { busqueda: "foco calido", planBusqueda: plan, categorias: ["Lámparas"] },
    nuevo: { texto: { q: "foco calido", plan }, categorias: ["Lámparas"] },
  },
  {
    nombre: "q + tolerante",
    viejos: { busqueda: "lampra", busquedaTolerante: true },
    nuevo: { texto: { q: "lampra", tolerante: true } },
  },
  { nombre: "vacío", viejos: { categorias: ["Lámparas"] }, nuevo: { categorias: ["Lámparas"] } },
];

describe.each(VARIANTES)("equivalencia de SQL: $nombre", ({ viejos, nuevo }) => {
  it("getPaginaCatalogo emite lo mismo con campos viejos y con `texto`", async () => {
    await getPaginaCatalogo({ soloVisibles: true, filtros: viejos, orden: "relevancia" });
    const antes = sinLecturaDelArbol(grabadora.consultas);
    grabadora = dbGrabadora(conConteo);
    await getPaginaCatalogo({ soloVisibles: true, filtros: nuevo, orden: "relevancia" });
    const despues = sinLecturaDelArbol(grabadora.consultas);
    expect(antes.length).toBeGreaterThan(0);
    expect(despues).toEqual(antes);
  });

  it("contarCatalogo emite lo mismo", async () => {
    await contarCatalogo({ soloVisibles: false, filtros: viejos });
    const antes = grabadora.consultas;
    grabadora = dbGrabadora(conConteo);
    await contarCatalogo({ soloVisibles: false, filtros: nuevo });
    expect(grabadora.consultas).toEqual(antes);
  });
});

describe("getPaginaCatalogo con sinConteo = lo que hoy lee getCatalogo (autocompletar, chat, selector del admin)", () => {
  it.each<[string, { q: string; tolerante?: boolean }]>([
    ["exacta", { q: "foco led" }],
    ["tolerante", { q: "lampra", tolerante: true }],
    ["sin términos", { q: "!!" }],
  ])("la consulta de %s es idéntica (SQL y parámetros)", async (_n, texto) => {
    await getCatalogo({ soloVisibles: true, busqueda: texto.q, tolerante: texto.tolerante, limit: 8 });
    const viejo = grabadora.consultas[0];
    grabadora = dbGrabadora(conConteo);
    await getPaginaCatalogo({ soloVisibles: true, filtros: { texto }, orden: "relevancia", porPagina: 8, sinConteo: true });
    expect(grabadora.consultas).toHaveLength(1);
    expect(grabadora.consultas[0]).toEqual(viejo);
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
