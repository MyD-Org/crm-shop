import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, esLecturaDelArbol, sinLecturaDelArbol } from "@/db/__fixtures__/db-grabadora";

/**
 * El catálogo (listado, ficha, facetas y menú) toma stock, precios y estado de
 * la misma elección por fila que la cotización: la vista del CRM si se leyó de
 * Alegra después que el espejo del Shop, si no el espejo (ver
 * `stock-disponible.ts`). Nombre, marca, categoría e IVA siguen siendo del
 * espejo del Shop.
 */

let arbol: unknown[][] = [];
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  getCatalogo,
  getCategorias,
  getFacetas,
  getPaginaCatalogo,
  getProducto,
  getProductosPorIds,
  mapFilaToProduct,
} from "./catalog";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  arbol = [];
  // count(*) = 1 para que la página también dispare la consulta de filas.
  grabadora = dbGrabadora((c) => (esLecturaDelArbol(c) ? arbol : c.sql.includes("count(*)") ? [[1]] : []));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const JOIN_CRM =
  /left join "public"\."catalog_products_shop" on \("catalog_products_shop"\."alegra_id" = "shop"\."catalog_products"\."alegra_id" and "catalog_products_shop"\."tenant_id" = \$(\d+)\)/;

const USAR_CRM =
  '(case when ("catalog_products_shop"."alegra_leido_at" is not null and "catalog_products_shop"."alegra_leido_at" > "shop"."catalog_products"."synced_at") then';

const ACTIVO = `then "catalog_products_shop"."activo" else "shop"."catalog_products"."status" = 'active' end`;
const STOCK = 'then "catalog_products_shop"."stock" else "shop"."catalog_products"."stock" end';
const PRECIOS = 'then "catalog_products_shop"."precios_alegra" else "shop"."catalog_products"."prices" end';

/** Joinea la vista con el tenant del Shop y no filtra `status` por fuera de la elección. */
function exigeFuenteCrm(c: { sql: string; params: unknown[] }) {
  const m = c.sql.match(JOIN_CRM);
  expect(m, c.sql).not.toBeNull();
  expect(c.params[Number(m![1]) - 1]).toBe("tenant-test");
  expect(c.sql).not.toMatch(/"shop"\."catalog_products"\."status" = \$\d+/);
}

describe("el catálogo lee stock, precio y estado de la fuente más fresca", () => {
  it("página del catálogo: conteo y filas", async () => {
    await getPaginaCatalogo({ filtros: { soloStock: true, precioMin: 10 }, orden: "precio-asc" });
    const [conteo, pagina] = grabadora.consultas;
    for (const c of [conteo, pagina]) {
      exigeFuenteCrm(c);
      expect(c.sql).toContain(ACTIVO);
      // "solo con stock" y el precio (filtro, orden y "con precio") pasan por la elección.
      expect(c.sql).toContain(STOCK);
      expect(c.sql).toContain(PRECIOS);
    }
    expect(pagina.sql).toContain(USAR_CRM);
  });

  it("getCatalogo (home y autocompletado)", async () => {
    await getCatalogo({ limit: 10 });
    exigeFuenteCrm(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain(ACTIVO);
  });

  it("ficha: getProducto y getProductosPorIds", async () => {
    await getProducto("5");
    exigeFuenteCrm(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain(ACTIVO);
    expect(grabadora.consultas[0].sql).toContain(STOCK);

    grabadora.consultas.length = 0;
    await getProductosPorIds(["5"]);
    exigeFuenteCrm(grabadora.consultas[0]);
    // Sin `soloActivos` no filtra por estado (pedidos viejos siguen mostrando el nombre).
    expect(grabadora.consultas[0].sql).not.toContain(ACTIVO);
  });

  it("facetas con categorías de Alegra", async () => {
    await getFacetas({});
    const consultas = sinLecturaDelArbol(grabadora.consultas);
    expect(consultas).toHaveLength(3);
    for (const c of consultas) {
      exigeFuenteCrm(c);
      expect(c.sql).toContain(ACTIVO);
    }
  });

  it("facetas y menú con árbol propio", async () => {
    arbol = [["c1", null, "ILUMINACION", 1]];
    await getFacetas({});
    await getCategorias();
    for (const c of sinLecturaDelArbol(grabadora.consultas)) exigeFuenteCrm(c);
  });

  it("menú con categorías de Alegra: sólo las que tienen productos activos según la fuente elegida", async () => {
    await getCategorias();
    const [c] = sinLecturaDelArbol(grabadora.consultas);
    exigeFuenteCrm(c);
    expect(c.sql).toContain(ACTIVO);
  });
});

describe("mapFilaToProduct con precios del CRM", () => {
  const fila = {
    alegraId: "5",
    name: "COD-5",
    code: null,
    description: "Lámpara",
    brand: "Marca",
    stock: "8",
    ivaPorcentaje: "21",
    categoryName: null,
    overlayNombre: null,
    overlayFotos: null,
  };

  it("resuelve la lista del cliente y la principal sobre el price crudo de Alegra", () => {
    const prices = [
      { idPriceList: 1, name: "General", price: "1000", main: true },
      { idPriceList: 7, name: "Mayorista", price: 800 },
    ];
    expect(mapFilaToProduct({ ...fila, prices }, undefined, [], null)).toMatchObject({ price: 1000, stockQty: 8 });
    expect(mapFilaToProduct({ ...fila, prices }, "7", [], null).price).toBe(800);
  });
});
