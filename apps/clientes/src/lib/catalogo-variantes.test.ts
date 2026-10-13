import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Lecturas del selector de variantes (flag `variantes-selector`): el resumen de las cards y las
 * opciones de la ficha. Prueban la FORMA de las consultas (tenant, filtros) y cómo se arma el
 * resultado con filas sintéticas, sin base.
 */

const TENANT = "tenant-variantes";

let grabadora = dbGrabadora();
let responder: (c: ConsultaGrabada) => unknown[][] | undefined = () => [];
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { conResumenDeVariantes, getProducto, getProductosPorSkus, getVariantesDeGrupo, representantesDePadres } from "./catalog";
import type { Product } from "@/data/products";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
  vi.stubEnv("R2_SHOP_MEDIA_PUBLIC_URL", "https://medios.cliente.example");
  vi.stubEnv("SHOP_MEDIA_HOSTS", "medios.cliente.example");
  responder = () => [];
  grabadora = dbGrabadora((c) => responder(c));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const producto = (id: string, extra: Partial<Product> = {}): Product => ({
  id,
  name: `Cinta LED ${id}`,
  brand: "Marca",
  price: 100,
  stock: "in",
  ...extra,
});

const precios = (n: number) => JSON.stringify([{ idPriceList: "1", name: "General", price: n, main: true }]);

describe("conResumenDeVariantes", () => {
  it("sin productos no consulta", async () => {
    expect(await conResumenDeVariantes([])).toEqual([]);
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("productos sueltos (sin grupo): quedan como estaban y se consulta una sola vez", async () => {
    const lista = [producto("1"), producto("2")];
    expect(await conResumenDeVariantes(lista)).toEqual(lista);
    expect(grabadora.consultas).toHaveLength(1);
  });

  it("modelo con precios iguales: cantidad de opciones, sin 'Desde'", async () => {
    responder = (c) => (c.sql.includes("is not null") ? [["1", "g1"]] : [["g1", "1", "Blanco", precios(100), null], ["g1", "2", "Cálido", precios(100), null], ["g1", "3", "Frío", precios(100), null]]);
    const [p] = await conResumenDeVariantes([producto("1")]);
    expect(p.variantes).toEqual({ cantidad: 3, etiquetas: ["Blanco", "Cálido", "Frío"] });
  });

  it("las etiquetas van en orden natural, hasta 3 (agotadas incluidas), y la cantidad cuenta todas", async () => {
    const hermanas = ["10 m", "5 m", "2 m", "20 m"].map((e, i) => ["g1", String(i + 1), e, precios(100), null]);
    responder = (c) => (c.sql.includes("is not null") ? [["1", "g1"]] : hermanas);
    const [p] = await conResumenDeVariantes([producto("1")]);
    expect(p.variantes).toEqual({ cantidad: 4, etiquetas: ["2 m", "5 m", "10 m"] });
  });

  it("las etiquetas salen de la misma consulta de hermanas: no suman lecturas", async () => {
    responder = (c) => (c.sql.includes("is not null") ? [["1", "g1"]] : [["g1", "1", "A", precios(100), null], ["g1", "2", "B", precios(100), null]]);
    await conResumenDeVariantes([producto("1")]);
    expect(grabadora.consultas).toHaveLength(2);
    expect(grabadora.consultas[1].sql).toContain('"etiqueta"');
  });

  it("grupo manual con un suelto de otro precio: 'Desde' el más bajo (precio exhibido con IVA)", async () => {
    responder = (c) =>
      c.sql.includes("is not null")
        ? [["1", "g1"]]
        : [["g1", "1", null, precios(100), "21.00"], ["g1", "2", null, precios(100), "21.00"], ["g1", "3", null, precios(180), "21.00"]];
    const [p] = await conResumenDeVariantes([producto("1")]);
    expect(p.variantes).toEqual({ cantidad: 3, desde: 121 });
  });

  it("un modelo con una sola opción activa no se resume (sin selector ni etiqueta)", async () => {
    responder = (c) => (c.sql.includes("is not null") ? [["1", "g1"]] : [["g1", "1", null, precios(100), null]]);
    const [p] = await conResumenDeVariantes([producto("1")]);
    expect(p.variantes).toBeUndefined();
  });

  it("todas las consultas llevan el tenant y las hermanas sólo cuentan las activas con precio", async () => {
    responder = (c) => (c.sql.includes("is not null") ? [["1", "g1"]] : []);
    await conResumenDeVariantes([producto("1")]);
    expect(grabadora.consultas).toHaveLength(2);
    for (const c of grabadora.consultas) {
      expect(c.sql).toMatch(/"catalog_products_shop"\."tenant_id" = \$\d+/);
      expect(c.params).toContain(TENANT);
    }
    expect(grabadora.consultas[1].sql).toContain('"catalog_products_shop"."activo"');
  });
});

describe("getVariantesDeGrupo", () => {
  const fotoModelo = JSON.stringify([{ key: "productos/t/g1/aaa-1600.webp", w: 1600 }]);
  const fotoPropia = JSON.stringify([{ key: "productos/t/11/bbb-1600.webp", w: 1600 }]);
  // Orden de columnas: las del catálogo (14) + etiqueta, tipo, esRepresentante, fotosPropias.
  const fila = (id: string, etiqueta: string | null, o: { stock: string | null; precio: number; rep: boolean; propia: string | null }) => [
    id, `Cinta LED ${id}`, `COD-${id}`, null, "Marca", precios(o.precio), o.stock, null, "ILUMINACION",
    "Cinta LED 5050", fotoModelo, null, null, null,
    etiqueta, "variante", o.rep, o.propia,
  ];

  it("arma una opción por variante: precio y stock propios, foto propia o la del modelo", async () => {
    responder = () => [
      fila("12", "Verde", { stock: "10", precio: 100, rep: false, propia: fotoPropia }),
      fila("11", "Rojo", { stock: "0", precio: 100, rep: true, propia: null }),
      fila("13", "RGB", { stock: "3", precio: 180, rep: false, propia: null }),
    ];
    const opciones = await getVariantesDeGrupo("g1", { soloVisibles: true });
    // Orden por etiqueta, no por el de la consulta.
    expect(opciones.map((o) => o.etiqueta)).toEqual(["RGB", "Rojo", "Verde"]);
    const por = Object.fromEntries(opciones.map((o) => [o.etiqueta, o]));
    expect(por.Verde.producto.id).toBe("12");
    expect(por.Verde.producto.images?.[0].url).toBe("https://medios.cliente.example/productos/t/11/bbb-1600.webp");
    expect(por.Rojo.producto.images?.[0].url).toBe("https://medios.cliente.example/productos/t/g1/aaa-1600.webp");
    expect(por.Rojo.producto.stock).toBe("out");
    expect(por.Verde.producto.stock).toBe("in");
    expect(por.RGB.producto.price).toBe(180);
    expect(por.Rojo.esRepresentante).toBe(true);
    // El nombre es el del modelo (overlay del ancla), igual para todas.
    expect(new Set(opciones.map((o) => o.producto.name)).size).toBe(1);
    expect(por.Rojo.producto.name).toBe("Cinta LED 5050");
  });

  it("una etiqueta vacía cae al nombre del producto", async () => {
    responder = () => [fila("12", null, { stock: "10", precio: 100, rep: true, propia: null })];
    const [o] = await getVariantesDeGrupo("g1", { soloVisibles: false });
    expect(o.etiqueta).toBe("Cinta LED 5050");
  });

  it("ordena las medidas de forma natural ('5 m' antes que '10 m')", async () => {
    responder = () => [
      fila("1", "10 m", { stock: "1", precio: 1, rep: false, propia: null }),
      fila("2", "5 m", { stock: "1", precio: 1, rep: true, propia: null }),
    ];
    const opciones = await getVariantesDeGrupo("g1", { soloVisibles: false });
    expect(opciones.map((o) => o.etiqueta)).toEqual(["5 m", "10 m"]);
  });

  it("filtra por tenant, grupo, activas y con precio; el overlay del modelo y el propio llevan el tenant en el ON", async () => {
    await getVariantesDeGrupo("g1", { soloVisibles: true });
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/"catalog_products_shop"\."tenant_id" = \$\d+/);
    expect(c.sql).toContain('"catalog_products_shop"."grupo_id" = $');
    expect(c.sql).toContain('"catalog_products_shop"."activo"');
    expect(c.sql).toMatch(/"catalog_overlay"\."alegra_id" = "catalog_products_shop"\."overlay_alegra_id"/);
    expect(c.sql).toMatch(/"overlay_propio"\."alegra_id" = "catalog_products_shop"\."alegra_id" and "overlay_propio"\."tenant_id" = \$\d+/);
    expect(c.params.filter((p) => p === TENANT).length).toBeGreaterThanOrEqual(3);
    expect(c.params).toContain("g1");
  });
});

describe("getProducto con el flag (agrupar)", () => {
  const fotoModelo = JSON.stringify([{ key: "productos/t/g1/aaa-1600.webp", w: 1600 }]);
  const base = (id: string) => [id, `Cinta LED ${id}`, `COD-${id}`, null, "Marca", precios(100), "10", null, "ILUMINACION", "Cinta LED 5050", fotoModelo, null, null, null];
  const opcion = (id: string, etiqueta: string, rep: boolean) => [...base(id), etiqueta, rep, null];

  /** Contesta cada lectura de `getProducto` según su forma. */
  const contestar = (grupo: string | null, opciones: unknown[][], fotosPropias: unknown[][] = []) => (c: ConsultaGrabada) => {
    if (c.sql.includes('"overlay_propio"')) return opciones;
    // La foto propia de la variante pedida (overlay de ella misma, sólo con el flag).
    if (c.sql.startsWith('select "alegra_id", "fotos" from "public"."catalog_overlay"')) return fotosPropias;
    if (c.sql.startsWith('select "grupo_id" from')) return grupo ? [[grupo]] : [];
    return [base("12")];
  };

  it("una variante de un modelo con varias opciones trae el selector, con su propia opción y el representante", async () => {
    responder = contestar("g1", [opcion("11", "Rojo", true), opcion("12", "Verde", false)]);
    const p = await getProducto("12", { soloVisibles: true, agrupar: true });
    expect(p?.id).toBe("12");
    expect(p?.grupo?.representanteId).toBe("11");
    expect(p?.grupo?.opciones.map((o) => o.id)).toEqual(["11", "12"]);
    expect(p?.grupo?.opciones.every((o) => !("esRepresentante" in o))).toBe(true);
  });

  it("la variante pedida usa su foto propia si la tiene, y la del modelo si no", async () => {
    const propia = JSON.stringify([{ key: "productos/t/12/zzz-1600.webp", w: 1600 }]);
    responder = contestar(null, [], [["12", propia]]);
    const conPropia = await getProducto("12", { soloVisibles: true, agrupar: true });
    expect(conPropia?.images?.[0]?.url).toContain("productos/t/12/zzz");
    responder = contestar(null, []);
    const sinPropia = await getProducto("12", { soloVisibles: true, agrupar: true });
    expect(sinPropia?.images?.[0]?.url).toContain("productos/t/g1/aaa");
  });

  it("un modelo con una sola opción activa se muestra sin selector", async () => {
    responder = contestar("g1", [opcion("12", "Verde", true)]);
    const p = await getProducto("12", { soloVisibles: true, agrupar: true });
    expect(p?.id).toBe("12");
    expect(p?.grupo).toBeUndefined();
  });

  it("si la variante pedida no figura entre las opciones (sin precio, oculta), sin selector", async () => {
    responder = contestar("g1", [opcion("11", "Rojo", true), opcion("13", "Azul", false)]);
    const p = await getProducto("12", { soloVisibles: true, agrupar: true });
    expect(p?.grupo).toBeUndefined();
  });

  it("un producto suelto no consulta opciones", async () => {
    responder = contestar(null, []);
    const p = await getProducto("12", { soloVisibles: true, agrupar: true });
    expect(p?.grupo).toBeUndefined();
    expect(grabadora.consultas.some((c) => c.sql.includes('"overlay_propio"'))).toBe(false);
  });

  it("el id de un padre (nunca activo) o inexistente da null: 404", async () => {
    responder = () => [];
    expect(await getProducto("99", { soloVisibles: true, agrupar: true })).toBeNull();
  });

  it("con el flag apagado no hay consultas de grupo: la ficha de siempre", async () => {
    responder = contestar("g1", [opcion("11", "Rojo", true), opcion("12", "Verde", false)]);
    const p = await getProducto("12", { soloVisibles: true });
    expect(p?.grupo).toBeUndefined();
    expect(grabadora.consultas).toHaveLength(1);
  });
});

describe("representantesDePadres", () => {
  it("sin ids no consulta", async () => {
    expect((await representantesDePadres([])).size).toBe(0);
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("id de modelo (padre) -> su representante activo; todo con el tenant en el WHERE", async () => {
    responder = () => [["10", "11"]];
    const m = await representantesDePadres(["10", "55"]);
    expect([...m]).toEqual([["10", "11"]]);
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/"catalog_products_shop"\."tenant_id" = \$\d+/);
    expect(c.sql).toContain('"tipo" = $');
    expect(c.params).toContain("padre");
  });
});

describe("getProductosPorSkus con el flag (agrupar)", () => {
  it("el código de cualquier variante trae al representante de su modelo (una card por modelo)", async () => {
    responder = () => [];
    await getProductosPorSkus(["p18-rojo"], { soloVisibles: true, agrupar: true });
    const [c] = grabadora.consultas;
    expect(c.sql).toContain('"grupo_id" in (select');
    expect(c.sql).toContain('"es_representante"');
    expect(c.params).toContain("P18-ROJO");
    expect(c.params.filter((p) => p === TENANT).length).toBeGreaterThanOrEqual(2);
  });

  it("apagado: la consulta de siempre, sin subconsulta de grupos", async () => {
    responder = () => [];
    await getProductosPorSkus(["p18-rojo"], { soloVisibles: true });
    expect(grabadora.consultas[0].sql).not.toContain('"grupo_id" in (select');
  });
});
