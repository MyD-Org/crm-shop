import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Búsqueda v2 en las consultas reales del catálogo (sin base): con plan, el
 * texto recupera (OR, comienzo de palabra) en vez de filtrar con AND, los
 * duros siguen siendo filtros y `relevancia` ordena con el puntaje del plan.
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getPaginaCatalogo } from "./catalog";
import { filtrosCacheables } from "./catalogo-publico";
import type { CriterioPlan } from "./busqueda-v2/piezas";

const conConteo = (c: ConsultaGrabada) => (c.sql.startsWith("select count(*)::int") ? [[1]] : undefined);

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});
afterEach(() => vi.unstubAllEnvs());

const plan: CriterioPlan = {
  consulta: "foco cálido e27",
  blandos: {
    categorias: [{ nombre: "Bulbos", peso: 0.9 }],
    atributos: [],
    terminos: [
      { texto: "foco", peso: 1 },
      { texto: "lampara", peso: 0.7 },
    ],
  },
};

describe("catálogo con plan de búsqueda v2", () => {
  it("el texto recupera con OR (regex de comienzo de palabra) y no con el LIKE AND clásico", async () => {
    await getPaginaCatalogo({
      soloVisibles: false,
      filtros: { texto: { q: "foco cálido e27", plan }, categorias: ["Lámparas"], atributos: ["tono-calido"] },
      orden: "relevancia",
    });
    expect(grabadora.consultas).toHaveLength(2);
    for (const { sql, params } of grabadora.consultas) {
      expect(params).toContain("(^|[^a-z0-9])(foco)");
      expect(params).toContain("(^|[^a-z0-9])(lampara)");
      expect(params).not.toContain("%foco%");
      expect(params).not.toContain("%e27%");
      // Los duros siguen filtrando: la categoría (subárbol) y el atributo.
      expect(params).toContain("Lámparas");
      expect(sql).toContain("~*");
    }
    const [, filas] = grabadora.consultas;
    expect(filas.sql).toMatch(/order by [\s\S]*then 4 when [\s\S]* then 3 when [\s\S]* then 2 when [\s\S]* then 1 else 0 end/);
  });

  it("sin plan, la búsqueda clásica de siempre (LIKE por término)", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: { texto: { q: "foco" } }, orden: "relevancia" });
    for (const { params } of grabadora.consultas) expect(params).toContain("%foco%");
  });

  it("con plan no se cachea (una clave por búsqueda)", () => {
    expect(filtrosCacheables({ texto: { q: "", plan } })).toBe(false);
    expect(filtrosCacheables({ categorias: ["Lámparas"] })).toBe(true);
  });
});
