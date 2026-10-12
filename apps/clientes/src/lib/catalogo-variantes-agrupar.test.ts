import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, esLecturaDelArbol, sinLecturaDelArbol } from "@/db/__fixtures__/db-grabadora";

/**
 * Contrato del flag `variantes-selector` en las consultas del catálogo (change
 * `variantes-de-producto`, rebanada S5a).
 *
 * - Apagado (`agrupar` ausente o false): el SQL NO nombra las columnas nuevas de la vista
 *   (`es_representante`, `overlay_alegra_id`) y el overlay se une por el id del propio producto:
 *   es el SQL de antes del cambio.
 * - Prendido: el listado, el conteo, las facetas y los destacados se acotan al representante y el
 *   overlay se une por `overlay_alegra_id` (el ancla del grupo). La ficha, el carrito, los favoritos
 *   y la cotización leen el overlay del ancla pero NO se acotan al representante: la variante pedida
 *   tiene que salir aunque no sea la representante.
 * - Con el flag prendido, el tenant sigue en toda consulta (la guarda de `catalogo-tenant.test.ts`).
 */

const TENANT = "tenant-agrupar";

let arbol: unknown[][] = [];
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  getCatalogo,
  getCategoriaExacta,
  getCategorias,
  getFacetas,
  getPaginaCatalogo,
  getProducto,
  getProductosPorIds,
  getProductosPorSkus,
  contarCatalogo,
} from "./catalog";
import { cotizar } from "./cotizacion";
import { enListado } from "./catalogo-fuente";
import { noVisiblesEnTx } from "./stock-disponible";
import { leerDisponibilidadBruta } from "./stock-sucursal";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
  arbol = [];
  grabadora = dbGrabadora((c) => (esLecturaDelArbol(c) ? arbol : c.sql.includes("count(*)") ? [[1]] : []));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const REPRESENTANTE = '"catalog_products_shop"."es_representante" = $';
const OVERLAY_DEL_GRUPO = '"catalog_overlay"."alegra_id" = "catalog_products_shop"."overlay_alegra_id"';
const OVERLAY_PROPIO = '"catalog_overlay"."alegra_id" = "catalog_products_shop"."alegra_id"';

/** Todas las consultas que corre `fn` contra la vista de productos. */
async function sqlDe(fn: () => Promise<unknown>): Promise<string[]> {
  grabadora.consultas.length = 0;
  await fn();
  return sinLecturaDelArbol(grabadora.consultas)
    .filter((c) => c.sql.includes('"catalog_products_shop"'))
    .map((c) => c.sql);
}

const consultas: [string, (agrupar?: boolean) => Promise<unknown>][] = [
  ["getCatalogo", (a) => getCatalogo({ soloVisibles: false, ...(a === undefined ? {} : { agrupar: a }) })],
  [
    "getPaginaCatalogo (conteo y filas)",
    (a) => getPaginaCatalogo({ soloVisibles: false, orden: "precio-desc", ...(a === undefined ? {} : { agrupar: a }) }),
  ],
  ["contarCatalogo", (a) => contarCatalogo({ soloVisibles: false, filtros: {}, ...(a === undefined ? {} : { agrupar: a }) })],
  ["getProductosPorSkus (destacados)", (a) => getProductosPorSkus(["X1"], { soloVisibles: false, ...(a === undefined ? {} : { agrupar: a }) })],
  [
    "getCategoriaExacta (relacionados)",
    async (a) => {
      grabadora = dbGrabadora((c) => (c.sql.includes('"shop_categories"') ? [["Cat"]] : []));
      return getCategoriaExacta({ categoriaId: "11111111-1111-1111-1111-111111111111", limit: 4, soloVisibles: false, ...(a === undefined ? {} : { agrupar: a }) });
    },
  ],
];

describe("agrupar apagado: el SQL es el de siempre", () => {
  it.each(consultas)("%s no nombra las columnas del grupo ni acota al representante", async (_n, fn) => {
    for (const apagado of [undefined, false]) {
      const sqls = await sqlDe(() => fn(apagado));
      expect(sqls.length).toBeGreaterThan(0);
      for (const sql of sqls) {
        expect(sql).not.toContain("es_representante");
        expect(sql).not.toContain("overlay_alegra_id");
        if (sql.includes('"catalog_overlay"')) expect(sql).toContain(OVERLAY_PROPIO);
      }
    }
  });

  it("facetas, categorías, ficha, carrito y cotización: tampoco", async () => {
    arbol = [["c1", null, "ILUMINACION", 1]];
    for (const fn of [
      () => getFacetas({ marcas: ["M"] }, false),
      () => getCategorias(false),
      () => getProducto("5", { soloVisibles: false }),
      () => getProductosPorIds(["5"], { soloActivos: true }),
      () => cotizar([{ id: "5", qty: 1 }]),
    ]) {
      for (const sql of await sqlDe(fn)) {
        expect(sql).not.toContain("es_representante");
        expect(sql).not.toContain("overlay_alegra_id");
      }
    }
  });

});

describe("agrupar prendido", () => {
  it.each(consultas)("%s: sólo el representante y el overlay del ancla, en el mismo WHERE de las filas y del conteo", async (_n, fn) => {
    const sqls = await sqlDe(() => fn(true));
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) {
      expect(sql).toContain(REPRESENTANTE);
      expect(sql).toContain(OVERLAY_DEL_GRUPO);
      expect(sql).not.toContain(OVERLAY_PROPIO);
    }
  });

  it("getPaginaCatalogo: el conteo y las filas se acotan igual (mismos totales de paginación)", async () => {
    const sqls = await sqlDe(() => getPaginaCatalogo({ soloVisibles: false, orden: "precio-desc", agrupar: true }));
    expect(sqls).toHaveLength(2);
    expect(sqls.filter((s) => s.includes("count(*)"))).toHaveLength(1);
    expect(sqls.every((s) => s.includes(REPRESENTANTE))).toBe(true);
  });

  it("facetas y conteos por categoría cuentan un producto por modelo", async () => {
    for (const arb of [[], [["c1", null, "ILUMINACION", 1]]]) {
      arbol = arb;
      const sqls = await sqlDe(() => getFacetas({ marcas: ["M"] }, false, undefined, true));
      expect(sqls.length).toBeGreaterThanOrEqual(3);
      for (const sql of sqls) {
        expect(sql).toContain(REPRESENTANTE);
        expect(sql).toContain(OVERLAY_DEL_GRUPO);
      }
    }
  });

  it("el menú de categorías cuenta un producto por modelo", async () => {
    arbol = [["c1", null, "ILUMINACION", 1]];
    const sqls = await sqlDe(() => getCategorias(false, undefined, true));
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) expect(sql).toContain(REPRESENTANTE);
  });

  it("la ficha, el carrito y los favoritos leen el overlay del ancla pero NO se acotan al representante", async () => {
    for (const fn of [
      () => getProducto("5", { soloVisibles: false, agrupar: true }),
      () => getProductosPorIds(["5", "7"], { soloActivos: true, soloVisibles: true, agrupar: true }),
    ]) {
      const sqls = await sqlDe(fn);
      expect(sqls.length).toBeGreaterThan(0);
      for (const sql of sqls) {
        expect(sql).toContain(OVERLAY_DEL_GRUPO);
        expect(sql).not.toContain("es_representante");
      }
    }
  });

  it("la cotización lee el overlay del ancla y no filtra por representante", async () => {
    const sqls = await sqlDe(() => cotizar([{ id: "5", qty: 1 }], { agrupar: true, soloVisibles: true }));
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) {
      expect(sql).toContain(OVERLAY_DEL_GRUPO);
      expect(sql).not.toContain("es_representante");
    }
  });

  it("la visibilidad dentro de la transacción del pedido y el ocultamiento por sucursal usan el ancla", async () => {
    for (const fn of [
      () => noVisiblesEnTx(grabadora.db as never, ["5"], true),
      () => leerDisponibilidadBruta(["5"], ["sede-a"], "sede-a", grabadora.db as never, true),
    ]) {
      const sqls = await sqlDe(fn);
      expect(sqls.some((s) => s.includes(OVERLAY_DEL_GRUPO))).toBe(true);
      for (const sql of sqls) expect(sql).not.toContain("es_representante");
    }
    // Apagado, el mismo helper une por el id del propio producto.
    for (const sql of await sqlDe(() => noVisiblesEnTx(grabadora.db as never, ["5"]))) {
      expect(sql).toContain(OVERLAY_PROPIO);
    }
  });

  it("el tenant sigue en toda consulta del catálogo", async () => {
    arbol = [["c1", null, "ILUMINACION", 1]];
    for (const fn of [
      () => getPaginaCatalogo({ soloVisibles: true, orden: "relevancia", filtros: { texto: { q: "x" } }, agrupar: true }),
      () => getFacetas({}, true, undefined, true),
      () => getProducto("5", { soloVisibles: false, agrupar: true }),
    ]) {
      const sqls = await sqlDe(fn);
      for (const sql of sqls) {
        expect(sql).toMatch(/"catalog_products_shop"\."tenant_id" = \$\d+/);
      }
    }
    const params = grabadora.consultas.flatMap((c) => c.params);
    expect(params).toContain(TENANT);
  });
});

describe("enListado", () => {
  it("apagado no agrega condición; prendido, una sobre es_representante", () => {
    expect(enListado(false)).toBeUndefined();
    expect(enListado(true)).toBeDefined();
  });
});
