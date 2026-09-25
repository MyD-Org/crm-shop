import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, esLecturaDelArbol, sinLecturaDelArbol } from "@/db/__fixtures__/db-grabadora";

/**
 * El catálogo (listado, ficha, facetas, menú) y la cotización leen TODO de las
 * vistas del CRM (`catalog_products_shop` y `catalog_categories_shop`), con el
 * stock menos la reserva de los pedidos vivos del Shop. Ya no hay elección de
 * fuente por fila ni lectura del espejo viejo del Shop.
 *
 * La guarda de tenant de cada función vive en `catalogo-tenant.test.ts`.
 */

let arbol: unknown[][] = [];
let filas: unknown[][] = [];
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
import { cotizar } from "./cotizacion";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  arbol = [];
  filas = [];
  // count(*) = 1 para que la página también dispare la consulta de filas.
  grabadora = dbGrabadora((c) =>
    esLecturaDelArbol(c) ? arbol : c.sql.includes("count(*)") ? [[1]] : filas,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const FROM_VISTA = 'from "public"."catalog_products_shop"';
const ACTIVO = '"catalog_products_shop"."activo"';
const STOCK_DISPONIBLE =
  '(case when "catalog_products_shop"."stock" is null then null else greatest(0, "catalog_products_shop"."stock" - coalesce("stock_reservado"."qty", 0)) end)';

const JOIN_CATEGORIAS =
  /left join "public"\."catalog_categories_shop" on \("catalog_categories_shop"\."alegra_id" = "catalog_products_shop"\."category_alegra_id" and "catalog_categories_shop"\."tenant_id" = \$(\d+)\)/;

const JOIN_RESERVA =
  /left join "shop"\."stock_reservado" on \("stock_reservado"\."alegra_item_id" = "catalog_products_shop"\."alegra_id" and "stock_reservado"\."tenant_id" = \$(\d+)\)/;

/** Base = vista del CRM; categorías y reserva con el tenant en el join; nada del espejo viejo. */
function exigeFuenteCrm(c: { sql: string; params: unknown[] }) {
  expect(c.sql).toContain(FROM_VISTA);
  expect(c.sql).not.toContain('"shop"."catalog_products"');
  expect(c.sql).not.toContain('"shop"."catalog_categories"');
  expect(c.sql).not.toMatch(/case when .*alegra_leido_at/);
  const cat = c.sql.match(JOIN_CATEGORIAS);
  expect(cat, c.sql).not.toBeNull();
  expect(c.params[Number(cat![1]) - 1]).toBe("tenant-test");
  const r = c.sql.match(JOIN_RESERVA);
  expect(r, c.sql).not.toBeNull();
  expect(c.params[Number(r![1]) - 1]).toBe("tenant-test");
}

describe("el catálogo lee del CRM, menos la reserva", () => {
  it("página del catálogo: conteo y filas", async () => {
    await getPaginaCatalogo({ filtros: { soloStock: true, precioMin: 10 }, orden: "precio-asc" });
    const [conteo, pagina] = grabadora.consultas;
    for (const c of [conteo, pagina]) {
      exigeFuenteCrm(c);
      expect(c.sql).toContain(ACTIVO);
      // "solo con stock" mira el disponible (stock − reservado).
      expect(c.sql).toContain(STOCK_DISPONIBLE);
      // Precio (filtro, orden y "con precio") de los precios crudos de Alegra y el IVA de la vista.
      expect(c.sql).toContain('jsonb_typeof("catalog_products_shop"."precios_alegra")');
      expect(c.sql).toContain('coalesce("catalog_products_shop"."iva_porcentaje", 0)');
    }
  });

  it("getCatalogo (home y autocompletado)", async () => {
    await getCatalogo({ limit: 10 });
    exigeFuenteCrm(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain(ACTIVO);
  });

  it("ficha: getProducto y getProductosPorIds", async () => {
    await getProducto("5");
    exigeFuenteCrm(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain(`where ("catalog_products_shop"."tenant_id" = $`);
    expect(grabadora.consultas[0].sql).toContain(`and ${ACTIVO}`);
    expect(grabadora.consultas[0].sql).toContain(STOCK_DISPONIBLE);

    grabadora.consultas.length = 0;
    await getProductosPorIds(["5"]);
    exigeFuenteCrm(grabadora.consultas[0]);
    // Sin `soloActivos` no filtra por estado (pedidos viejos siguen mostrando el nombre).
    expect(grabadora.consultas[0].sql).not.toContain(`and ${ACTIVO}`);
  });

  it("facetas con categorías de Alegra: agrupan por el nombre de la vista de categorías", async () => {
    await getFacetas({});
    const consultas = sinLecturaDelArbol(grabadora.consultas);
    expect(consultas).toHaveLength(3);
    for (const c of consultas) {
      exigeFuenteCrm(c);
      expect(c.sql).toContain(ACTIVO);
    }
    expect(consultas.some((c) => c.sql.includes('group by "catalog_categories_shop"."name"'))).toBe(true);
    // Marca: la de la vista; si viene vacía, el nombre de la categoría de Alegra.
    expect(
      consultas.some((c) =>
        c.sql.includes('coalesce(nullif("catalog_products_shop"."brand", \'\'), "catalog_categories_shop"."name")'),
      ),
    ).toBe(true);
  });

  it("facetas y menú con árbol propio", async () => {
    arbol = [["c1", null, "ILUMINACION", 1]];
    await getFacetas({});
    await getCategorias();
    for (const c of sinLecturaDelArbol(grabadora.consultas)) exigeFuenteCrm(c);
  });

  it("menú con categorías de Alegra: activas, del tenant, con productos activos del mismo tenant", async () => {
    await getCategorias();
    const [c] = sinLecturaDelArbol(grabadora.consultas);
    expect(c.sql).toMatch(
      /from "public"\."catalog_categories_shop" inner join "public"\."catalog_products_shop" on \("catalog_products_shop"\."category_alegra_id" = "catalog_categories_shop"\."alegra_id" and "catalog_products_shop"\."tenant_id" = "catalog_categories_shop"\."tenant_id"\)/,
    );
    const where = c.sql.match(
      /where \("catalog_categories_shop"\."tenant_id" = \$(\d+) and "catalog_products_shop"\."tenant_id" = \$(\d+) and "catalog_categories_shop"\."activo" = \$(\d+) and "catalog_products_shop"\."activo"\)/,
    );
    expect(where, c.sql).not.toBeNull();
    expect(c.params[Number(where![1]) - 1]).toBe("tenant-test");
    expect(c.params[Number(where![2]) - 1]).toBe("tenant-test");
    expect(c.params[Number(where![3]) - 1]).toBe(true);
    expect(c.sql).not.toContain('"shop"."catalog_categories"');
  });
});

describe("cotización desde la vista del CRM", () => {
  it("una consulta con base en la vista, categorías y reserva con tenant", async () => {
    await cotizar([{ id: "5", qty: 1 }]);
    expect(grabadora.consultas).toHaveLength(1);
    exigeFuenteCrm(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain(
      `(case when ${ACTIVO} then 'active' else 'inactive' end)`,
    );
  });

  it("un ítem inactivo en Alegra (activo = false en la vista) no se vende: la línea queda con problema", async () => {
    // Orden del select de `leerEspejo`: alegraId, name, code, brand, prices, stock, ivaPorcentaje, status, categoryName.
    filas = [["5", "Lámpara", null, null, [{ idPriceList: 1, price: 100, main: true }], "3", "21.00", "inactive", null]];
    const c = await cotizar([{ id: "5", qty: 1 }]);
    expect(c.hayProblemas).toBe(true);
    expect(c.lineas[0].problema).toBe("inactivo");
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
