import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Venta sin stock por modalidad en las consultas del catálogo (sin base): la columna del overlay y el
 * predicado "a pedido" sólo con modalidades activas; sin ellas, el SQL de hoy. Con un contexto de
 * retiro que admite traslado (`retiro_sin_stock = ofrecer`), un producto que otra sucursal tiene NO
 * pasa a pedido (`overlayCubreOtra`).
 */
let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  contarCatalogo,
  getCatalogo,
  getCategoriaExacta,
  getFacetaCategorias,
  getFacetas,
  getPaginaCatalogo,
  getProducto,
  getProductosPorIds,
  getProductosPorSkus,
  getVariantesDeGrupo,
  mapFilaToProduct,
} from "./catalog";
import { modalidadesActivas } from "./venta-sin-stock-repo";
import { contextoDisponibilidad, type ContextoDisponibilidad } from "./disponibilidad-contexto";
import type { SucursalDato } from "./sucursales";
import type { CriterioPlan } from "./busqueda-v2/piezas";

// ids de modalidad = uuid: `literalUuids` descarta en silencio lo que no lo es.
const U1 = "00000000-0000-4000-8000-000000000001";
const M = { id: U1, texto: "Modalidad 48 h", plazoDias: 2, flujo: "en_linea" as const };

const COLUMNA = "modalidad_sin_stock_id";
const A_PEDIDO = `"public"."catalog_overlay"."modalidad_sin_stock_id" = any('{${U1}}'::uuid[])`;

const conConteo = (c: ConsultaGrabada) => (c.sql.startsWith("select count(*)::int") ? [[1]] : undefined);

async function grabar(fn: () => Promise<unknown>, responder: (c: ConsultaGrabada) => unknown[][] | undefined = conConteo) {
  grabadora = dbGrabadora(responder);
  await fn();
  return grabadora.consultas;
}

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora(conConteo);
});
afterEach(() => vi.unstubAllEnvs());

const sucursal = (slug: string, orden: number): SucursalDato => ({
  slug,
  orden,
  activa: true,
  predeterminada: orden === 0,
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
});
const SUCURSALES = [sucursal("sede-a", 0), sucursal("sede-b", 1)];
const retiroEnA = (retiroSinStock: "ofrecer" | "bloquear"): ContextoDisponibilidad =>
  contextoDisponibilidad({
    zona: null,
    sucursales: SUCURSALES,
    reglas: { trasladoDias: 2, retiroSinStock },
    modalidad: "retiro",
    local: "sede-a",
  })!;

const FILA = {
  alegraId: "7",
  name: "Producto genérico",
  code: "GEN-1",
  description: null,
  brand: "Marca",
  prices: [{ idPriceList: "1", name: "General", price: 1000, main: true }],
  stock: "0",
  ivaPorcentaje: null,
  categoryName: "Rubro",
  overlayNombre: null,
  overlayFotos: null,
};

describe("sin modalidades activas: el SQL de hoy", () => {
  it("sin modalidades activas el SQL es el de hoy (CRM 0094 sin aplicar)", async () => {
    const consultas = await grabar(() => getPaginaCatalogo({ soloVisibles: false, filtros: { soloStock: true } }));
    expect(consultas.length).toBeGreaterThan(0);
    for (const c of consultas) expect(c.sql).not.toContain(COLUMNA);
  });

  it("ni con un contexto que admite traslado (no hay union de sucursales nueva)", async () => {
    const disp = retiroEnA("ofrecer");
    const sinTraslado = { ...disp };
    delete sinTraslado.traslado;
    const con = await grabar(() => getPaginaCatalogo({ soloVisibles: false, disp, filtros: { soloStock: true } }));
    const sin = await grabar(() =>
      getPaginaCatalogo({ soloVisibles: false, disp: sinTraslado, filtros: { soloStock: true } }),
    );
    expect(con.map((c) => c.sql)).toEqual(sin.map((c) => c.sql));
    expect(con.map((c) => c.params)).toEqual(sin.map((c) => c.params));
    for (const c of con) expect(c.sql).not.toContain(COLUMNA);
  });

  it("ninguna lectura del catálogo nombra la columna", async () => {
    const consultas = [
      ...(await grabar(() => getCatalogo({ soloVisibles: false }))),
      ...(await grabar(() => getProductosPorIds(["7"]))),
      ...(await grabar(() => getProductosPorSkus(["GEN-1"], { soloVisibles: false }))),
      ...(await grabar(() => getVariantesDeGrupo("g1", { soloVisibles: false }))),
      ...(await grabar(() => getFacetas({ soloStock: true }, false))),
      ...(await grabar(() => contarCatalogo({ soloVisibles: false, filtros: { soloStock: true } }))),
    ];
    for (const c of consultas) expect(c.sql).not.toContain(COLUMNA);
  });
});

describe("con modalidades activas", () => {
  beforeEach(() => {
    vi.mocked(modalidadesActivas).mockResolvedValue([M]);
  });

  it("con modalidades, 'Solo con stock' cuenta los a pedido", async () => {
    const [conteo, pagina] = sinLecturaDelArbol(
      await grabar(() => getPaginaCatalogo({ soloVisibles: false, filtros: { soloStock: true } })),
    );
    // crmOverlay es `publico.table`: va calificado.
    for (const c of [conteo, pagina]) expect(c.sql).toContain(A_PEDIDO);
    expect(pagina.sql).toContain('"public"."catalog_overlay"."modalidad_sin_stock_id"');
    expect(conteo.sql).toMatch(/> 0 or "public"\."catalog_overlay"\."modalidad_sin_stock_id" = any/);
  });

  it("una sola lectura de las modalidades por función", async () => {
    vi.mocked(modalidadesActivas).mockClear();
    await grabar(() => getPaginaCatalogo({ soloVisibles: false, filtros: { soloStock: true } }));
    expect(modalidadesActivas).toHaveBeenCalledTimes(1);
    vi.mocked(modalidadesActivas).mockClear();
    await grabar(() => contarCatalogo({ soloVisibles: false, filtros: { soloStock: true } }));
    expect(modalidadesActivas).toHaveBeenCalledTimes(1);
  });

  it("las facetas con stock y la búsqueda usan el mismo predicado", async () => {
    // Toda consulta con el filtro "con stock" lleva el predicado a pedido (el conteo base de las
    // categorías, sin filtros, no lo lleva: es el total fijo de siempre).
    const STOCK_FILTRO = 'coalesce("stock_reservado"."qty", 0)) end) > 0';
    const conFiltro = (cs: ConsultaGrabada[]) => sinLecturaDelArbol(cs).filter((c) => c.sql.includes(STOCK_FILTRO));
    const facetas = conFiltro(await grabar(() => getFacetas({ soloStock: true }, false)));
    expect(facetas.length).toBeGreaterThanOrEqual(4); // categorías, marcas, precio, atributos
    for (const c of facetas) expect(c.sql).toContain(`${STOCK_FILTRO} or ${A_PEDIDO})`);
    const categorias = conFiltro(await grabar(() => getFacetaCategorias({ soloStock: true }, false)));
    expect(categorias.length).toBeGreaterThan(0);
    for (const c of categorias) expect(c.sql).toContain(`${STOCK_FILTRO} or ${A_PEDIDO})`);

    // Búsqueda v2: el puntaje del plan suma por "con stock" con el mismo predicado.
    const plan: CriterioPlan = {
      consulta: "lampara",
      blandos: { categorias: [], atributos: [], terminos: [{ texto: "lampara", peso: 1 }] },
    };
    const [, filas] = sinLecturaDelArbol(
      await grabar(() =>
        getPaginaCatalogo({ soloVisibles: false, filtros: { texto: { q: "lampara", plan } }, orden: "relevancia" }),
      ),
    );
    expect(filas.sql.split(" order by ")[1]).toContain(A_PEDIDO);
  });

  it("orden destacados: a pedido pesa como stock corto (literal, sin parámetros nuevos)", async () => {
    const con = sinLecturaDelArbol(await grabar(() => getPaginaCatalogo({ soloVisibles: false, orden: "destacados" })));
    vi.mocked(modalidadesActivas).mockResolvedValue([]);
    const sin = sinLecturaDelArbol(await grabar(() => getPaginaCatalogo({ soloVisibles: false, orden: "destacados" })));
    const ordenCon = con[1].sql.split(" order by ")[1];
    expect(ordenCon).toContain(`when 0 then (case when ${A_PEDIDO} then 1 else 8 end)`);
    expect(sin[1].sql.split(" order by ")[1]).toContain("when 0 then 8");
    expect(con[1].params).toEqual(sin[1].params);
  });

  it("las demás lecturas traen la columna del overlay", async () => {
    for (const fn of [
      () => getCatalogo({ soloVisibles: false }),
      () => getProductosPorIds(["7"]),
      () => getProductosPorSkus(["GEN-1"], { soloVisibles: false }),
      () => getVariantesDeGrupo("g1", { soloVisibles: false }),
      () => getCategoriaExacta({ categoriaId: U1, limit: 4, soloVisibles: false }),
    ]) {
      const consultas = await grabar(fn, (c) =>
        c.sql.includes('from "public"."shop_categories"') ? [["Rubro"]] : undefined,
      );
      expect(consultas.some((c) => c.sql.includes(`"catalog_overlay"."${COLUMNA}"`))).toBe(true);
    }
  });

  it("relacionados (categoría exacta, sólo con stock) incluyen los a pedido", async () => {
    const consultas = await grabar(
      () => getCategoriaExacta({ categoriaId: U1, limit: 4, soloVisibles: false }),
      (c) => (c.sql.includes('from "public"."shop_categories"') ? [["Rubro"]] : undefined),
    );
    expect(consultas.at(-1)!.sql).toContain(A_PEDIDO);
  });
});

describe("mapFilaToProduct", () => {
  it("mapFilaToProduct: modalidad activa → ventaSinStock; id desconocido o sin lista → nada", () => {
    expect(mapFilaToProduct({ ...FILA, stock: "0", overlayModalidadId: U1 }, undefined, [], null, undefined, [M]))
      .toMatchObject({ stock: "out", ventaSinStock: M });
    expect(
      mapFilaToProduct({ ...FILA, stock: "0", overlayModalidadId: "otra" }, undefined, [], null, undefined, [M]).ventaSinStock,
    ).toBeUndefined();
    expect(mapFilaToProduct({ ...FILA, stock: "0", overlayModalidadId: U1 }, undefined, [], null).ventaSinStock).toBeUndefined();
    // Con stock lleva la modalidad, pero `esAPedido` es false.
    expect(mapFilaToProduct({ ...FILA, stock: "9", overlayModalidadId: U1 }, undefined, [], null, undefined, [M]))
      .toMatchObject({ stock: "in", ventaSinStock: M });
  });

  it("sin stock pero otra sucursal alcanzable lo cubre: sin modalidad (se ve como hoy)", () => {
    const p = mapFilaToProduct(
      { ...FILA, stock: "0", overlayModalidadId: U1, overlayCubreOtra: true },
      undefined,
      [],
      null,
      undefined,
      [M],
    );
    expect(p.stock).toBe("out");
    expect(p).not.toHaveProperty("ventaSinStock");
    expect(
      mapFilaToProduct({ ...FILA, stock: "0", overlayModalidadId: U1, overlayCubreOtra: false }, undefined, [], null, undefined, [M])
        .ventaSinStock,
    ).toEqual(M);
  });
});

describe("retiro en un local sin stock, otro con stock (overlayCubreOtra)", () => {
  beforeEach(() => {
    vi.mocked(modalidadesActivas).mockResolvedValue([M]);
  });

  /** La fila de `getProductosPorIds`: columnas base, modalidad y (si se pidió) "cubre otra". */
  const fila = (cubreOtra?: boolean) => [
    "7", "Producto genérico", "GEN-1", null, "Marca",
    [{ idPriceList: "1", name: "General", price: 1000, main: true }],
    "0", null, "Rubro", null, null, null, null, null, null,
    U1,
    ...(cubreOtra === undefined ? [] : [cubreOtra]),
  ];

  it("`ofrecer`: el SELECT y el predicado llevan la unión de sucursales; sin ventaSinStock", async () => {
    const disp = retiroEnA("ofrecer");
    expect(disp.traslado).toBe(true);
    grabadora = dbGrabadora(() => [fila(true)]);
    const p = await getProducto("7", { soloVisibles: false, disp });
    expect(p?.stock).toBe("out");
    expect(p?.ventaSinStock).toBeUndefined();
    const [c] = grabadora.consultas;
    // La unión: el stock de sede-b además de su aparición en la visibilidad (`activas`).
    expect(c.params.filter((x) => x === "sede-b").length).toBeGreaterThan(1);
    expect(c.sql).toContain(`"public"."catalog_overlay"."${COLUMNA}"`);
  });

  it("`ofrecer` y nadie más lo tiene: con ventaSinStock", async () => {
    grabadora = dbGrabadora(() => [fila(false)]);
    const p = await getProducto("7", { soloVisibles: false, disp: retiroEnA("ofrecer") });
    expect(p?.ventaSinStock).toEqual(M);
  });

  it("`bloquear`: sin unión (la modalidad aplica aunque otra sucursal lo tenga)", async () => {
    const disp = retiroEnA("bloquear");
    grabadora = dbGrabadora(() => [fila()]);
    const p = await getProducto("7", { soloVisibles: false, disp });
    expect(p?.ventaSinStock).toEqual(M);
    const [c] = grabadora.consultas;
    // sede-b sólo por la visibilidad (`activas`): no hay unión de stock.
    expect(c.params.filter((x) => x === "sede-b")).toHaveLength(1);
  });

  it("'Solo con stock' y destacados usan la misma condición (con traslado, excluye lo que cubre otra)", async () => {
    const [conteo, pagina] = sinLecturaDelArbol(
      await grabar(() =>
        getPaginaCatalogo({ soloVisibles: false, disp: retiroEnA("ofrecer"), filtros: { soloStock: true }, orden: "destacados" }),
      ),
    );
    // El predicado a pedido con traslado: modalidad asignada Y ninguna sucursal alcanzable la cubre.
    const aPedido = new RegExp(`\\(${A_PEDIDO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} and not coalesce\\(`);
    expect(conteo.sql).toMatch(aPedido);
    const [where, orden] = pagina.sql.split(" order by ");
    expect(where).toMatch(aPedido);
    expect(orden).toMatch(aPedido);
    // La misma expresión (texto SQL) en el WHERE y en el escalón de destacados.
    const expr = (s: string) => {
      const i = s.indexOf(`(${A_PEDIDO} and not coalesce(`);
      let nivel = 0;
      for (let j = i; j < s.length; j++) {
        if (s[j] === "(") nivel++;
        else if (s[j] === ")" && --nivel === 0) return s.slice(i, j + 1);
      }
      throw new Error("sin cierre");
    };
    const enWhere = expr(where).replace(/\$\d+/g, "$");
    const enOrden = expr(orden).replace(/\$\d+/g, "$");
    expect(enOrden).toBe(enWhere);
    expect(orden).toContain(`when 0 then (case when ${expr(orden)} then 1 else 8 end)`);
  });

  it("`bloquear`: el predicado es sólo la modalidad (sin unión)", async () => {
    const [conteo] = sinLecturaDelArbol(
      await grabar(() => getPaginaCatalogo({ soloVisibles: false, disp: retiroEnA("bloquear"), filtros: { soloStock: true } })),
    );
    expect(conteo.sql).toContain(`> 0 or ${A_PEDIDO})`);
    expect(conteo.sql).not.toContain(`${A_PEDIDO} and not`);
  });
});
