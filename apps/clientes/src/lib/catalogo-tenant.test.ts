import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  esLecturaDelArbol,
  sinLecturaDelArbol,
  type ConsultaGrabada,
} from "@/db/__fixtures__/db-grabadora";

/**
 * Guarda de tenant del catálogo (D8 de `catalogo-shop-desde-crm`).
 *
 * Las vistas del CRM (`catalog_products_shop`, `catalog_categories_shop`) son de
 * TODOS los tenants y son la base de cada consulta del catálogo: una consulta
 * que se olvide del tenant muestra, cotiza o vende productos de otra empresa.
 * Este test corre cada función pública que lee el catálogo y exige, en CADA
 * consulta que nombra la vista de productos:
 *  - que la tenga de base (`from "public"."catalog_products_shop"`) o que sea la
 *    rama de categorías de Alegra (base = vista de categorías);
 *  - `"catalog_products_shop"."tenant_id" = $n` en el WHERE, con el tenant;
 *  - si joinea la vista de categorías, el tenant EN el ON del join.
 * Y que ninguna consulta lea las tablas viejas del Shop.
 */

const TENANT = "tenant-guarda";

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
} from "./catalog";
import { cotizar } from "./cotizacion";
import { disponiblesEnTx } from "./stock-disponible";
import { idListaGeneral } from "./contactos-espejo";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
  arbol = [];
  // count(*) = 1 para que la página también dispare la consulta de filas.
  grabadora = dbGrabadora((c) => (esLecturaDelArbol(c) ? arbol : c.sql.includes("count(*)") ? [[1]] : []));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const TENANT_PRODUCTOS = /"catalog_products_shop"\."tenant_id" = \$(\d+)/g;
const JOIN_CATEGORIAS =
  /left join "public"\."catalog_categories_shop" on \("catalog_categories_shop"\."alegra_id" = "catalog_products_shop"\."category_alegra_id" and "catalog_categories_shop"\."tenant_id" = \$(\d+)\)/;

/** Parte de la consulta desde el primer WHERE de nivel superior (sin subconsultas previas). */
function desdeWhere(sql: string): string {
  const i = sql.indexOf(" where ");
  return i === -1 ? "" : sql.slice(i);
}

function exigeTenant(c: ConsultaGrabada) {
  expect(c.sql, "lee las tablas viejas del Shop").not.toMatch(/"shop"\."catalog_(products|categories)"/);
  if (!c.sql.includes('"catalog_products_shop"')) return false;

  const baseCategorias = /from "public"\."catalog_categories_shop" inner join "public"\."catalog_products_shop"/.test(c.sql);
  if (!baseCategorias) expect(c.sql, c.sql).toMatch(/from "public"\."catalog_products_shop"/);

  // El tenant de la vista de productos, en el WHERE y con el valor del Shop.
  const enWhere = [...desdeWhere(c.sql).matchAll(TENANT_PRODUCTOS)];
  expect(enWhere.length, `sin tenant en el WHERE: ${c.sql}`).toBeGreaterThan(0);
  for (const m of enWhere) expect(c.params[Number(m[1]) - 1]).toBe(TENANT);

  if (c.sql.includes('"catalog_categories_shop"')) {
    if (baseCategorias) {
      const m = desdeWhere(c.sql).match(/"catalog_categories_shop"\."tenant_id" = \$(\d+)/);
      expect(m, c.sql).not.toBeNull();
      expect(c.params[Number(m![1]) - 1]).toBe(TENANT);
      expect(c.sql).toContain('"catalog_products_shop"."tenant_id" = "catalog_categories_shop"."tenant_id"');
    } else {
      const m = c.sql.match(JOIN_CATEGORIAS);
      expect(m, `join a categorías sin tenant: ${c.sql}`).not.toBeNull();
      expect(c.params[Number(m![1]) - 1]).toBe(TENANT);
    }
  }
  return true;
}

/** Corre `fn` y exige la guarda en todas las consultas al catálogo (al menos `minimo`). */
async function conGuarda(fn: () => Promise<unknown>, minimo = 1) {
  grabadora.consultas.length = 0;
  await fn();
  const alCatalogo = sinLecturaDelArbol(grabadora.consultas).filter(exigeTenant);
  expect(alCatalogo.length).toBeGreaterThanOrEqual(minimo);
}

describe("toda consulta del catálogo filtra por el tenant del Shop", () => {
  it("getCatalogo (con y sin búsqueda)", async () => {
    await conGuarda(() => getCatalogo({ limit: 5 }));
    await conGuarda(() => getCatalogo({ busqueda: "lampara" }));
  });

  it("getProductosPorIds y getProducto", async () => {
    await conGuarda(() => getProductosPorIds(["5", "7"]));
    await conGuarda(() => getProductosPorIds(["5"], { soloActivos: true }));
    await conGuarda(() => getProducto("5"));
  });

  it("getPaginaCatalogo: conteo y filas", async () => {
    await conGuarda(
      () =>
        getPaginaCatalogo({
          filtros: { busqueda: "x", categorias: ["A"], marcas: ["M"], precioMin: 1, precioMax: 9, soloStock: true },
          orden: "precio-desc",
        }),
      2,
    );
  });

  it("getFacetas sin árbol propio (categorías de Alegra) y con árbol", async () => {
    await conGuarda(() => getFacetas({ marcas: ["M"] }), 3);
    arbol = [["c1", null, "ILUMINACION", 1]];
    await conGuarda(() => getFacetas({ categorias: ["ILUMINACION"] }), 3);
  });

  it("getCategorias sin árbol propio y con árbol", async () => {
    await conGuarda(() => getCategorias(), 1);
    arbol = [["c1", null, "ILUMINACION", 1]];
    await conGuarda(() => getCategorias(), 1);
  });

  it("cotizar (leerEspejo)", async () => {
    await conGuarda(() => cotizar([{ id: "5", qty: 1 }]));
  });

  it("disponiblesEnTx (transacción del pedido)", async () => {
    await conGuarda(() => disponiblesEnTx(grabadora.db as never, ["5", "7"]));
  });

  it("idListaGeneral (lista de precios general)", async () => {
    await conGuarda(() => idListaGeneral());
  });
});
