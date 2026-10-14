import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Variante oculta por el admin (`catalog_overlay.oculta_en_tienda`, de SU PROPIA fila de overlay) o
 * inactiva en Alegra: no se muestra de ninguna forma. Todo pasa por `activoSql`, así que cada
 * superficie tiene que llevar la exclusión en su WHERE. Sin base: se mira la forma de la consulta.
 */

const TENANT = "tenant-ocultas";

let grabadora = dbGrabadora();
let responder: (c: ConsultaGrabada) => unknown[][] | undefined = () => [];
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  getCatalogo,
  getIdAlternativoDeVariante,
  contarCatalogo,
  getPaginaCatalogo,
  getProductosPorIds,
  getVariantesDeGrupo,
} from "./catalog";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
  responder = () => [];
  grabadora = dbGrabadora((c) => responder(c));
});
afterEach(() => vi.unstubAllEnvs());

/** La exclusión: NO EXISTS de una fila propia (mismo tenant y alegra_id) con la columna en true. */
const EXCLUYE_OCULTAS =
  /"catalog_products_shop"\."activo" and not exists \(select 1 from "public"\."catalog_overlay" where (?:"public"\.)?"catalog_overlay"\."tenant_id" = "catalog_products_shop"\."tenant_id" and (?:"public"\.)?"catalog_overlay"\."alegra_id" = "catalog_products_shop"\."alegra_id" and (?:"public"\.)?"catalog_overlay"\."oculta_en_tienda"\)/;

describe("variante oculta: la exclusión está en cada superficie", () => {
  it("selector de variantes de la ficha", async () => {
    await getVariantesDeGrupo("g1", { soloVisibles: false });
    expect(grabadora.consultas.at(-1)?.sql).toMatch(EXCLUYE_OCULTAS);
  });

  it("listado, con y sin agrupar", async () => {
    await getCatalogo({ soloVisibles: false, limit: 10 });
    await getCatalogo({ soloVisibles: false, limit: 10, agrupar: true });
    const productos = grabadora.consultas.filter((c) => c.sql.includes('from "public"."catalog_products_shop"'));
    expect(productos.length).toBeGreaterThanOrEqual(2);
    for (const c of productos) expect(c.sql).toMatch(EXCLUYE_OCULTAS);
  });

  it("página, conteo y facetas del catálogo", async () => {
    await getPaginaCatalogo({ soloVisibles: false, filtros: {} });
    await contarCatalogo({ soloVisibles: false, filtros: {} });
    const consultas = grabadora.consultas.filter((c) => c.sql.includes('from "public"."catalog_products_shop"'));
    expect(consultas.length).toBeGreaterThanOrEqual(2);
    for (const c of consultas) expect(c.sql).toMatch(EXCLUYE_OCULTAS);
  });

  it("carrito, favoritos y pedidos (soloActivos): la oculta no vuelve en el mapa", async () => {
    await getProductosPorIds(["11"], { soloActivos: true });
    expect(grabadora.consultas.at(-1)?.sql).toMatch(EXCLUYE_OCULTAS);
  });

  it("sin soloActivos no filtra: el carrito conserva la línea y la cotización la marca", async () => {
    await getProductosPorIds(["11"]);
    expect(grabadora.consultas.at(-1)?.sql).not.toContain("oculta_en_tienda");
  });
});

describe("getIdAlternativoDeVariante", () => {
  const precios = JSON.stringify([{ idPriceList: "1", name: "General", price: 100, main: true }]);
  const opcion = (id: string, etiqueta: string, rep: boolean) => [
    id, `Cinta ${id}`, `COD-${id}`, null, "Marca", precios, "10", null, "ILUMINACION",
    "Cinta", "[]", null, null, null,
    etiqueta, "variante", rep, null,
  ];

  it("elige la representante entre las opciones que quedan", async () => {
    responder = (c) =>
      c.sql.includes('"etiqueta"') ? [opcion("12", "Verde", false), opcion("13", "Rojo", true)] : [["g1"]];
    expect(await getIdAlternativoDeVariante("11", { soloVisibles: false })).toBe("13");
  });

  it("sin representante, la primera por etiqueta", async () => {
    responder = (c) =>
      c.sql.includes('"etiqueta"') ? [opcion("12", "Verde", false), opcion("13", "Azul", false)] : [["g1"]];
    expect(await getIdAlternativoDeVariante("11", { soloVisibles: false })).toBe("13");
  });

  it("null si no pertenece a un grupo, si no quedan opciones o si el id no es de producto", async () => {
    responder = () => [[null]];
    expect(await getIdAlternativoDeVariante("11", { soloVisibles: false })).toBeNull();
    responder = (c) => (c.sql.includes('"etiqueta"') ? [] : [["g1"]]);
    expect(await getIdAlternativoDeVariante("11", { soloVisibles: false })).toBeNull();
    expect(await getIdAlternativoDeVariante("no-es-un-id", { soloVisibles: false })).toBeNull();
  });

  it("la lectura del grupo no filtra por activo (justamente la pedida no lo está) y lleva el tenant", async () => {
    responder = (c) => (c.sql.includes('"etiqueta"') ? [] : [["g1"]]);
    await getIdAlternativoDeVariante("11", { soloVisibles: false });
    const grupo = grabadora.consultas[0].sql;
    expect(grupo).not.toContain("oculta_en_tienda");
    expect(grupo).toContain('"tenant_id" = $1');
  });
});
