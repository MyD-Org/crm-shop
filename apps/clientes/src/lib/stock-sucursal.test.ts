import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * Forma del SQL de stock por sucursal y de la visibilidad por sucursal (flag
 * `disponibilidad-sucursal`). La aritmética la hace Postgres; acá se fija DE DÓNDE sale: el stock
 * por sucursal del CRM menos la reserva por sucursal, con el tenant del Shop en cada join, y el
 * ocultamiento por sucursal del overlay.
 */

const TENANT = "tenant-test";
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { contarCatalogo, getCatalogo, getFacetas, getPaginaCatalogo } from "./catalog";
import { cotizar } from "./cotizacion";
import { leerDisponibilidadBruta } from "./stock-sucursal";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";

const disp: ContextoDisponibilidad = {
  zona: "sede-b",
  activas: ["sede-a", "sede-b"],
  contarEn: ["sede-a", "sede-b"],
  stockHeredado: "sede-a",
};

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
  grabadora = dbGrabadora((c) => (c.sql.includes("count(*)") ? [[1]] : []));
});
afterEach(() => vi.unstubAllEnvs());

const ultima = () => grabadora.consultas[grabadora.consultas.length - 1];

describe("catálogo con `disp`", () => {
  it("el stock sale de catalog_stock_sucursal menos stock_reservado_sucursal, con el tenant en cada lectura", async () => {
    await getCatalogo({ soloVisibles: false, disp });
    const { sql, params } = ultima();
    // stock de la sucursal: por la PK (tenant, sucursal, producto)
    expect(sql).toMatch(
      /select "public"\."catalog_stock_sucursal"\."stock" from "public"\."catalog_stock_sucursal"\s+where "public"\."catalog_stock_sucursal"\."tenant_id" = \$\d+ and "public"\."catalog_stock_sucursal"\."sucursal" = \$\d+\s+and "public"\."catalog_stock_sucursal"\."alegra_id" = "catalog_products_shop"\."alegra_id"/,
    );
    // lo reservado: un mapa por sucursal calculado una vez por consulta (sin correlación)
    expect(sql).toMatch(
      /select jsonb_object_agg\("stock_reservado_sucursal"\."alegra_item_id", "stock_reservado_sucursal"\."qty"\)\s+from "shop"\."stock_reservado_sucursal"\s+where "stock_reservado_sucursal"\."tenant_id" = \$\d+ and "stock_reservado_sucursal"\."sucursal" = \$\d+\s+\) ->> "catalog_products_shop"\."alegra_id"/,
    );
    // el tenant y los slugs viajan como parámetros
    expect(params.filter((p) => p === TENANT).length).toBeGreaterThanOrEqual(4);
    expect(params).toContain("sede-a");
    expect(params).toContain("sede-b");
  });

  it("nunca negativo, el mejor entre las sucursales y respalda el stock de la vista SOLO si el producto no tiene filas por sucursal", async () => {
    await getCatalogo({ soloVisibles: false, disp });
    const { sql } = ultima();
    expect(sql).toContain("greatest(0,");
    expect(sql).toContain('when "catalog_products_shop"."stock" is null then null else coalesce(greatest(');
    // el respaldo: una vez por expresión (sólo en la sucursal que hereda), por hash y no por fila
    const respaldos = sql.match(
      /"catalog_products_shop"\."alegra_id" not in \(\s*select "public"\."catalog_stock_sucursal"\."alegra_id" from "public"\."catalog_stock_sucursal" where "public"\."catalog_stock_sucursal"\."tenant_id" = \$\d+\s*\) then "catalog_products_shop"\."stock" else 0 end/g,
    );
    const expresiones = sql.match(/else coalesce\(greatest\(/g);
    expect(respaldos?.length).toBe(expresiones?.length);
  });

  it("no cuenta el stock de una sucursal donde el producto está oculto", async () => {
    await getCatalogo({ soloVisibles: false, disp });
    const ocultas = ultima().sql.match(
      /case when \$\d+ <> all\(coalesce\("public"\."catalog_overlay"\."oculto_en_sucursales", '\{\}'::text\[\]\)\) then greatest\(0,/g,
    );
    // una por sucursal que cuenta, en cada expresión
    expect((ocultas?.length ?? 0) % disp.contarEn.length).toBe(0);
    expect(ocultas?.length).toBeGreaterThanOrEqual(disp.contarEn.length);
  });

  it("toda consulta del catálogo usa el lateral por sucursal y no la reserva única", async () => {
    await getPaginaCatalogo({ soloVisibles: true, filtros: { soloStock: true }, disp });
    await getFacetas({ soloStock: true }, true, disp);
    await contarCatalogo({ soloVisibles: true, filtros: { soloStock: true }, disp });
    const delCatalogo = grabadora.consultas.filter((c) => c.sql.includes('from "public"."catalog_products_shop"'));
    expect(delCatalogo.length).toBeGreaterThanOrEqual(5);
    for (const c of delCatalogo) {
      expect(c.sql).toContain('left join lateral (select max(d.v) as "disponible" from (select (case when');
      expect(c.sql).not.toContain('left join "shop"."stock_reservado" on');
    }
  });

  it("excluye lo oculto en todas las sucursales activas", async () => {
    await getCatalogo({ soloVisibles: false, disp });
    expect(ultima().sql).toContain(
      'not (coalesce("public"."catalog_overlay"."oculto_en_sucursales", \'{}\'::text[]) @> ARRAY[$',
    );
  });

  it("la página, el conteo y las facetas comparten el filtro de visibilidad", async () => {
    await getPaginaCatalogo({ soloVisibles: false, disp });
    await getFacetas({}, false, disp);
    const conFiltro = grabadora.consultas.filter((c) =>
      c.sql.includes("@> ARRAY["),
    );
    expect(conFiltro.length).toBeGreaterThanOrEqual(4);
  });

  it("el filtro 'con stock' usa el stock por sucursal", async () => {
    await getPaginaCatalogo({
      soloVisibles: false,
      filtros: { soloStock: true },
      disp,
    });
    const consulta = grabadora.consultas.find((c) =>
      c.sql.includes("count(*)"),
    )!;
    // del lateral: calculado una vez por fila, no dos veces en el WHERE
    expect(consulta.sql).toContain('left join lateral (select max(d.v) as "disponible"');
    expect(consulta.sql).toContain(
      '("stock_sucursal"."disponible" is null or "stock_sucursal"."disponible" > 0)',
    );
    expect(consulta.sql.match(/else coalesce\(greatest\(/g)?.length).toBe(1);
  });

  it("en modalidad retiro el local elegido tampoco puede tenerlo oculto", async () => {
    await getCatalogo({
      soloVisibles: false,
      disp: { ...disp, contarEn: ["sede-a"], local: "sede-a" },
    });
    expect(ultima().sql).toContain(
      '= any(coalesce("public"."catalog_overlay"."oculto_en_sucursales"',
    );
  });
});

describe("catálogo SIN `disp` (flag apagado)", () => {
  it("no toca las tablas por sucursal ni el overlay por sucursal", async () => {
    await getCatalogo({ soloVisibles: false });
    await getPaginaCatalogo({
      soloVisibles: false,
      filtros: { soloStock: true },
    });
    for (const c of grabadora.consultas) {
      expect(c.sql).not.toContain("catalog_stock_sucursal");
      expect(c.sql).not.toContain("stock_reservado_sucursal");
      expect(c.sql).not.toContain("oculto_en_sucursales");
    }
  });
});

describe("cotización con `disp`", () => {
  it("el stock y el estado consideran las sucursales; sin `disp` no", async () => {
    await cotizar([{ id: "1", qty: 1 }], { disp });
    const con = ultima().sql;
    expect(con).toContain("stock_reservado_sucursal");
    expect(con).toContain("@> ARRAY[");
    await cotizar([{ id: "1", qty: 1 }]);
    expect(ultima().sql).not.toContain("stock_reservado_sucursal");
  });
});

describe("leerDisponibilidadBruta", () => {
  it("lee sólo los ids pedidos, del tenant del Shop, y arma los tres mapas", async () => {
    grabadora = dbGrabadora((c) => {
      if (c.sql.includes('from "public"."catalog_products_shop"'))
        return [
          ["5", "9", ["sede-b"]],
          ["7", null, null],
        ];
      if (c.sql.includes('from "public"."catalog_stock_sucursal"'))
        return [["5", "sede-a", "4"]];
      if (c.sql.includes('from "shop"."stock_reservado_sucursal"'))
        return [["5", "sede-a", "1"]];
      return [];
    });
    const r = await leerDisponibilidadBruta(
      ["5", "7"],
      ["sede-a", "sede-b"],
      "sede-a",
      grabadora.db as never,
    );
    expect(r.stockPorSucursal).toEqual({
      "5": { "sede-a": 4, "sede-b": 0 },
      "7": null,
    });
    expect(r.reservadoPorSucursal).toEqual({ "5": { "sede-a": 1 } });
    expect(r.ocultoEn).toEqual({ "5": ["sede-b"] });
    expect(grabadora.consultas).toHaveLength(3);
    for (const c of grabadora.consultas) expect(c.params).toContain(TENANT);
  });

  it("sin ids no consulta", async () => {
    const r = await leerDisponibilidadBruta(
      [],
      ["sede-a"],
      "sede-a",
      grabadora.db as never,
    );
    expect(r).toEqual({
      stockPorSucursal: {},
      reservadoPorSucursal: {},
      ocultoEn: {},
    });
    expect(grabadora.consultas).toHaveLength(0);
  });
});
