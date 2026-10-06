import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Tolerante CON plan (`texto.tolerante` + `texto.plan`): el typo de un término no hace perder los
 * duros ni el resto del plan. La condición es la del plan (recupera por OR) o el parecido por
 * trigramas de cada término que recupera (peso >= 0.6, 4 letras o más); los duros siguen siendo
 * filtros y el orden suma el parecido al puntaje del plan. Sin base: `dbGrabadora`.
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
  consulta: "lamparas plafon e27",
  blandos: {
    categorias: [{ nombre: "Bulbos", peso: 0.9 }],
    atributos: [],
    terminos: [
      { texto: "lamparas", peso: 1 },
      { texto: "plafon", peso: 0.7 },
      { texto: "e27", peso: 1 },
      { texto: "interior", peso: 0.4 },
    ],
  },
};

async function leer(filtros: FiltrosCatalogo) {
  await getPaginaCatalogo({ soloVisibles: false, filtros, orden: "relevancia" });
  const [conteo, filas] = sinLecturaDelArbol(grabadora.consultas);
  return { conteo, filas };
}

const veces = (texto: string, parte: string) => texto.split(parte).length - 1;

describe("texto.tolerante + texto.plan: SQL", () => {
  it("recupera con el plan (OR, comienzo de palabra) o por parecido de cada término que recupera de 4 letras o más", async () => {
    const { conteo } = await leer({ texto: { q: "lamparas plafon e27", plan, tolerante: true } });
    // La recuperación del plan sigue ahí…
    expect(conteo.params).toContain("(^|[^a-z0-9])(lamparas|lampara)");
    expect(conteo.sql).toContain("~");
    // …y por parecido: lamparas (raíz singular) y plafon; no e27 (3 letras) ni interior (contexto: no recupera).
    expect(veces(conteo.sql, "public.word_similarity(")).toBe(2);
    expect(conteo.params).toContain("lampara");
    expect(conteo.params).toContain("plafon");
    expect(conteo.params).not.toContain("e27");
    expect(conteo.params).toContain(0.5);
  });

  it("los duros siguen siendo filtros (categorías y atributos de la URL)", async () => {
    const { conteo } = await leer({
      texto: { q: "lamparas plafon", plan, tolerante: true },
      categorias: ["Lámparas"],
      atributos: ["tono-calido"],
    });
    expect(conteo.params).toContain("Lámparas");
  });

  it("el orden suma el parecido de cada término que recupera al puntaje del plan", async () => {
    const { filas } = await leer({ texto: { q: "lamparas plafon e27", plan, tolerante: true } });
    const orden = filas.sql.slice(filas.sql.indexOf("order by"));
    expect(orden).toMatch(/then 4 when [\s\S]* then 3 when [\s\S]* then 2 when [\s\S]* then 1 else 0 end/);
    expect(veces(orden, "public.word_similarity(")).toBe(2);
    expect(orden).toContain("* 4");
  });

  it("sin tolerante, el plan queda como hoy: sin ningún parecido por trigramas", async () => {
    const { conteo, filas } = await leer({ texto: { q: "lamparas plafon e27", plan } });
    expect(conteo.sql).not.toContain("word_similarity");
    expect(filas.sql).not.toContain("word_similarity");
  });

  it("un plan que sólo recupera por categoría no suma trigramas (no hay término de 4 letras que recupere)", async () => {
    const soloCategoria: CriterioPlan = {
      consulta: "iluminar un cartel",
      blandos: { categorias: [{ nombre: "Reflectores", peso: 0.9 }], atributos: [], terminos: [{ texto: "cartel", peso: 0.4 }] },
    };
    const { conteo } = await leer({ texto: { q: "iluminar un cartel", plan: soloCategoria, tolerante: true } });
    expect(conteo.sql).not.toContain("word_similarity");
  });

  it("el plan viaja intacto: un atributo blando de id arbitrario sigue puntuando", async () => {
    const conMedida: CriterioPlan = {
      ...plan,
      blandos: { ...plan.blandos, atributos: [{ id: "corriente_a:20", peso: 1 }] },
    };
    const { filas } = await leer({ texto: { q: "lamparas plafon", plan: conMedida, tolerante: true } });
    expect(filas.sql).toContain("order by");
    expect(veces(filas.sql.slice(filas.sql.indexOf("order by")), "public.word_similarity(")).toBe(2);
  });
});
