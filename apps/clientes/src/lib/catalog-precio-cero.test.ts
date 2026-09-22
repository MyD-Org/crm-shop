import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol } from "@/db/__fixtures__/db-grabadora";

/**
 * Un ítem sin precio en Alegra llega al espejo con `prices` vacío y el SQL de
 * precio lo resuelve a 0. Si se lista, la home y el catálogo lo muestran a
 * "$ 0" con botón de comprar, y la venta sale a precio cero. Regla: ningún
 * listado público devuelve productos con precio 0. El control comercial de
 * fondo es la visibilidad del overlay del CRM; esto es la red de seguridad
 * del Shop.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getCatalogo, getFacetas, getPaginaCatalogo } from "./catalog";

beforeEach(() => {
  // count(*) = 1 para que la página también dispare la consulta de filas.
  grabadora = dbGrabadora((c) => (c.sql.includes("count(*)") ? [[1]] : []));
});

/** El predicado de precio va sobre el mismo coalesce que arma el precio de lista. */
const exigePrecioPositivo = (sql: string) =>
  expect(sql).toMatch(/coalesce\(\s*case when jsonb_typeof[\s\S]*?\)\s*>\s*0/);

describe("productos sin precio (precio 0)", () => {
  it("getCatalogo los excluye", async () => {
    await getCatalogo({ limit: 10 });
    expect(grabadora.consultas).toHaveLength(1);
    exigePrecioPositivo(grabadora.consultas[0].sql);
  });

  it("getPaginaCatalogo los excluye del conteo y de la página", async () => {
    await getPaginaCatalogo({ pagina: 1 });
    expect(grabadora.consultas).toHaveLength(2);
    for (const c of grabadora.consultas) exigePrecioPositivo(c.sql);
  });

  it("getFacetas no los cuenta en categorías, marcas ni rango de precio", async () => {
    await getFacetas({});
    const consultas = sinLecturaDelArbol(grabadora.consultas);
    expect(consultas).toHaveLength(3);
    for (const c of consultas) exigePrecioPositivo(c.sql);
  });
});
