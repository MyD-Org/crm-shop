import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Forma de las consultas de favoritos: todo acceso a `shop.favorites` lleva el
 * tenant del entorno y el usuario de Clerk, al leer, escribir y borrar. Se
 * ejecutan las funciones reales contra un cliente que graba el SQL.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  agregarFavorito,
  agregarFavoritosLote,
  contarFavoritos,
  FavoritosLlenosError,
  idsFavoritos,
  listarFavoritos,
  MAX_FAVORITOS,
  quitarFavorito,
} from "./favoritos";
import { setFlag } from "@/test/flags";

beforeEach(() => {
  grabadora = dbGrabadora();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Valor del parámetro que acompaña a `"favorites"."<columna>" = $n`. */
function paramDe(c: ConsultaGrabada, columna: string): unknown {
  const m = c.sql.match(new RegExp(`"favorites"\\."${columna}" = \\$(\\d+)`));
  expect(m, `${columna} en: ${c.sql}`).not.toBeNull();
  return c.params[Number(m![1]) - 1];
}

/** Tenant del entorno + usuario: la condición de TODA consulta a favoritos. */
function esperaDueno(c: ConsultaGrabada, usuario = "u1", tenant = "tenant-a") {
  expect(c.sql).toContain('"shop"."favorites"');
  expect(paramDe(c, "tenant_id")).toBe(tenant);
  expect(paramDe(c, "clerk_user_id")).toBe(usuario);
}

describe("idsFavoritos", () => {
  it("del usuario y del tenant, del más nuevo al más viejo", async () => {
    grabadora = dbGrabadora(() => [["42"], ["7"]]);
    expect(await idsFavoritos("u1")).toEqual(["42", "7"]);
    expect(grabadora.consultas).toHaveLength(1);
    const [c] = grabadora.consultas;
    esperaDueno(c);
    expect(c.sql).toMatch(/order by "shop"\."favorites"\."created_at" desc/);
  });

  it("otro tenant, otro filtro", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "tenant-b");
    await idsFavoritos("u2");
    esperaDueno(grabadora.consultas[0], "u2", "tenant-b");
  });

  it("sin SHOP_TENANT_ID no consulta", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "  ");
    await expect(idsFavoritos("u1")).rejects.toThrow(/SHOP_TENANT_ID/);
    expect(grabadora.consultas).toHaveLength(0);
  });
});

describe("contarFavoritos", () => {
  it("cuenta las filas del usuario y del tenant", async () => {
    grabadora = dbGrabadora(() => [[3]]);
    expect(await contarFavoritos("u1")).toBe(3);
    const [c] = grabadora.consultas;
    expect(c.sql).toContain("count(");
    esperaDueno(c);
  });
});

describe("agregarFavorito", () => {
  it("cuenta primero y después inserta idempotente con el tenant del entorno", async () => {
    grabadora = dbGrabadora((c) => (c.sql.startsWith("select") ? [[5, false]] : undefined));
    await agregarFavorito("u1", "42");
    expect(grabadora.consultas).toHaveLength(2);
    const [conteo, insert] = grabadora.consultas;
    expect(conteo.sql).toContain("count(");
    esperaDueno(conteo);
    expect(insert.sql).toMatch(/^insert into "shop"\."favorites"/);
    expect(insert.sql).toMatch(
      /on conflict \("tenant_id","clerk_user_id","alegra_item_id"\) do nothing/,
    );
    expect(insert.params).toEqual(expect.arrayContaining(["tenant-a", "u1", "42"]));
  });

  it(`con ${MAX_FAVORITOS} guardados, uno nuevo falla con el error del tope y no inserta`, async () => {
    grabadora = dbGrabadora(() => [[MAX_FAVORITOS, false]]);
    await expect(agregarFavorito("u1", "nuevo")).rejects.toBeInstanceOf(FavoritosLlenosError);
    expect(grabadora.consultas).toHaveLength(1);
    expect(grabadora.consultas.some((c) => c.sql.startsWith("insert"))).toBe(false);
  });

  it("en el tope, volver a guardar uno que ya estaba no es error ni escribe", async () => {
    grabadora = dbGrabadora(() => [[MAX_FAVORITOS, true]]);
    await expect(agregarFavorito("u1", "42")).resolves.toBeUndefined();
    expect(grabadora.consultas).toHaveLength(1);
  });

  it("el conteo mira si el ítem ya está guardado", async () => {
    grabadora = dbGrabadora(() => [[0, false]]);
    await agregarFavorito("u1", "42");
    const [conteo] = grabadora.consultas;
    const m = conteo.sql.match(/bool_or\((?:"shop"\."favorites"\.)?"alegra_item_id" = \$(\d+)\)/);
    expect(m, conteo.sql).not.toBeNull();
    expect(conteo.params[Number(m![1]) - 1]).toBe("42");
  });
});

describe("quitarFavorito", () => {
  it("borra sólo el ítem del usuario y del tenant", async () => {
    await quitarFavorito("u1", "42");
    expect(grabadora.consultas).toHaveLength(1);
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^delete from "shop"\."favorites"/);
    esperaDueno(c);
    expect(paramDe(c, "alegra_item_id")).toBe("42");
  });
});

describe("listarFavoritos", () => {
  // Fila del espejo en el orden de COLUMNAS_CATALOGO (ver catalog-por-ids.test.ts).
  const fila = (id: string, nombre: string) => [
    id, nombre, null, null, "Marca Ejemplo", [{ idPriceList: "1", price: 1000 }], "10", "21", null, null, [],
  ];

  it("dos consultas: ids con límite y productos del espejo sin filtro de visibilidad", async () => {
    setFlag("catalogo-solo-visibles", true);
    grabadora = dbGrabadora((c) =>
      c.sql.includes('"shop"."favorites"') ? [["42"], ["7"]] : [fila("7", "B"), fila("42", "A")],
    );
    await listarFavoritos("u1", { limite: 4 });
    expect(grabadora.consultas).toHaveLength(2);
    const [ids, productos] = grabadora.consultas;
    esperaDueno(ids);
    const m = ids.sql.match(/ limit \$(\d+)/);
    expect(m, ids.sql).not.toBeNull();
    expect(ids.params[Number(m![1]) - 1]).toBe(4);
    expect(productos.sql).toContain('from "public"."catalog_products_shop"');
    expect(productos.sql).not.toContain('"visible"');
  });

  it("en el orden de los favoritos y omitiendo los que el espejo ya no tiene", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.includes('"shop"."favorites"')
        ? [["42"], ["99"], ["7"]]
        : [fila("7", "Siete"), fila("42", "Cuarenta y dos")],
    );
    const productos = await listarFavoritos("u1");
    expect(productos.map((p) => p.id)).toEqual(["42", "7"]);
  });

  it("sin favoritos no consulta el espejo", async () => {
    expect(await listarFavoritos("u1")).toEqual([]);
    expect(grabadora.consultas).toHaveLength(1);
  });
});

describe("agregarFavoritosLote", () => {
  const filas = (n: number, desde = 1) => Array.from({ length: n }, (_, i) => [String(desde + i)]);
  const respuesta = (existentes: string[][]) => (c: ConsultaGrabada) =>
    c.sql.startsWith("select") && c.sql.includes("alegra_item_id") ? existentes : undefined;

  it("toma el lock del usuario, lee los existentes del dueño e inserta en un solo statement", async () => {
    grabadora = dbGrabadora(respuesta(filas(3)));
    const r = await agregarFavoritosLote("u1", ["1", "50", "51"]);
    expect(r.agregados).toEqual(["50", "51"]);
    expect(r.yaEstaban).toBe(1);
    expect(r.sinLugar).toBe(0);
    expect(r.ids).toEqual(["50", "51", "1", "2", "3"]);

    const sqls = grabadora.consultas.map((c) => c.sql);
    expect(sqls[0]).toContain("pg_advisory_xact_lock");
    expect(grabadora.consultas[0].params).toEqual(["favoritos:tenant-a:u1"]);
    const lectura = grabadora.consultas.find((c) => c.sql.includes('from "shop"."favorites"'))!;
    esperaDueno(lectura);
    const inserts = grabadora.consultas.filter((c) => c.sql.startsWith("insert"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/on conflict \("tenant_id","clerk_user_id","alegra_item_id"\) do nothing/);
    expect(inserts[0].params).toEqual(expect.arrayContaining(["tenant-a", "u1", "50", "51"]));
  });

  it(`con ${MAX_FAVORITOS - 1} guardados, 3 nuevos: entra 1 y no falla`, async () => {
    grabadora = dbGrabadora(respuesta(filas(MAX_FAVORITOS - 1)));
    const r = await agregarFavoritosLote("u1", ["9001", "9002", "9003"]);
    expect(r.agregados).toEqual(["9001"]);
    expect(r.sinLugar).toBe(2);
  });

  it("todos ya guardados: no inserta", async () => {
    grabadora = dbGrabadora(respuesta(filas(3)));
    const r = await agregarFavoritosLote("u1", ["1", "2"]);
    expect(r).toMatchObject({ agregados: [], yaEstaban: 2, sinLugar: 0 });
    expect(grabadora.consultas.some((c) => c.sql.startsWith("insert"))).toBe(false);
  });

  it("otro tenant: el lock y la lectura llevan ese tenant", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "tenant-b");
    await agregarFavoritosLote("u2", ["1"]);
    expect(grabadora.consultas[0].params).toEqual(["favoritos:tenant-b:u2"]);
    esperaDueno(grabadora.consultas[1], "u2", "tenant-b");
  });
});
