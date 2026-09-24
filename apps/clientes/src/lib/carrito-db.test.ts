import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  valoresInsertados,
  type ConsultaGrabada,
} from "@/db/__fixtures__/db-grabadora";

/**
 * Forma de las consultas del carrito por usuario: TODA consulta a `shop.carts`
 * lleva el tenant del entorno y el usuario de Clerk; el reemplazo exige la
 * versión vista (concurrencia optimista) y el merge bloquea la fila. Se
 * ejecutan las funciones reales contra un cliente que graba el SQL.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const getProductosPorIds = vi.fn();
vi.mock("./catalog", () => ({
  getProductosPorIds: (...args: unknown[]) => getProductosPorIds(...args),
}));

import {
  enriquecer,
  leerCarrito,
  mergearCarrito,
  reemplazarCarrito,
  vaciarCarritoTx,
} from "./carrito-db";

beforeEach(() => {
  grabadora = dbGrabadora();
  getProductosPorIds.mockReset();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Valor del parámetro que acompaña a `"carts"."<columna>" = $n`. */
function paramDe(c: ConsultaGrabada, columna: string): unknown {
  const m = c.sql.match(new RegExp(`"carts"\\."${columna}" = \\$(\\d+)`));
  expect(m, `${columna} en: ${c.sql}`).not.toBeNull();
  return c.params[Number(m![1]) - 1];
}

/** Tenant del entorno + usuario: la condición de TODA consulta con where. */
function esperaDueno(c: ConsultaGrabada, usuario = "u1", tenant = "tenant-a") {
  expect(c.sql).toContain('"shop"."carts"');
  expect(paramDe(c, "tenant_id")).toBe(tenant);
  expect(paramDe(c, "clerk_user_id")).toBe(usuario);
}

/** `version = version + 1` en el SET. */
const SUBE_VERSION = /"version" = "shop"\."carts"\."version" \+ 1/;

const tipo = (c: ConsultaGrabada) => c.sql.split(" ")[0];
const json = (v: unknown) => JSON.stringify(v);

describe("leerCarrito", () => {
  it("del usuario y del tenant", async () => {
    grabadora = dbGrabadora(() => [[[{ id: "1", qty: 2 }], 4]]);
    expect(await leerCarrito("u1")).toEqual({ items: [{ id: "1", qty: 2 }], version: 4 });
    expect(grabadora.consultas).toHaveLength(1);
    esperaDueno(grabadora.consultas[0]);
  });

  it("sin fila: vacío en versión 0", async () => {
    expect(await leerCarrito("u1")).toEqual({ items: [], version: 0 });
  });

  it("lo guardado se normaliza al leer (basura en la fila no llega al cliente)", async () => {
    grabadora = dbGrabadora(() => [[[{ id: "1", qty: 2 }, { id: "1", qty: 1 }, { x: 1 }, "y"], 2]]);
    expect(await leerCarrito("u1")).toEqual({ items: [{ id: "1", qty: 3 }], version: 2 });
  });
});

describe("reemplazarCarrito", () => {
  it("con la versión vigente: UPDATE con version en el WHERE y version + 1", async () => {
    grabadora = dbGrabadora((c) => (tipo(c) === "update" ? [[5]] : []));
    const r = await reemplazarCarrito("u1", 4, [{ id: "1", qty: 2 }]);
    expect(r).toEqual({ ok: true, carrito: { items: [{ id: "1", qty: 2 }], version: 5 }, avisos: [] });

    expect(grabadora.consultas).toHaveLength(1);
    const [u] = grabadora.consultas;
    expect(tipo(u)).toBe("update");
    esperaDueno(u);
    expect(paramDe(u, "version")).toBe(4);
    expect(u.sql).toMatch(SUBE_VERSION);
    expect(u.params).toContain(json([{ id: "1", qty: 2 }]));
  });

  it("normaliza antes de escribir y devuelve los avisos", async () => {
    grabadora = dbGrabadora((c) => (tipo(c) === "update" ? [[2]] : []));
    const r = await reemplazarCarrito("u1", 1, [
      { id: "1", qty: 3 },
      { id: "1", qty: 2 },
      { id: "2", qty: 20_000 },
      { id: "3", qty: 0 },
    ]);
    expect(r).toEqual({
      ok: true,
      carrito: { items: [{ id: "1", qty: 5 }, { id: "2", qty: 9_999 }], version: 2 },
      avisos: ["cantidad"],
    });
    expect(grabadora.consultas[0].params).toContain(
      json([{ id: "1", qty: 5 }, { id: "2", qty: 9_999 }]),
    );
  });

  it("versión 0 sin fila: INSERT ... ON CONFLICT DO NOTHING en versión 1", async () => {
    grabadora = dbGrabadora((c) => (tipo(c) === "insert" ? [[1]] : []));
    const r = await reemplazarCarrito("u1", 0, [{ id: "1", qty: 1 }]);
    expect(r).toEqual({ ok: true, carrito: { items: [{ id: "1", qty: 1 }], version: 1 }, avisos: [] });

    const [u, ins] = grabadora.consultas;
    expect(tipo(u)).toBe("update");
    expect(tipo(ins)).toBe("insert");
    expect(ins.sql).toContain('"shop"."carts"');
    expect(ins.sql).toMatch(/on conflict \("tenant_id","clerk_user_id"\) do nothing/);
    const v = valoresInsertados(ins);
    expect(v.tenant_id).toBe("tenant-a");
    expect(v.clerk_user_id).toBe("u1");
    expect(v.version).toBe(1);
  });

  it("versión vieja: no escribe y devuelve el carrito actual", async () => {
    grabadora = dbGrabadora((c) => (tipo(c) === "select" ? [[[{ id: "9", qty: 1 }], 5]] : []));
    const r = await reemplazarCarrito("u1", 4, [{ id: "1", qty: 2 }]);
    expect(r).toEqual({ ok: false, actual: { items: [{ id: "9", qty: 1 }], version: 5 } });

    const [u, sel] = grabadora.consultas;
    expect(tipo(u)).toBe("update");
    expect(tipo(sel)).toBe("select");
    esperaDueno(sel);
    expect(grabadora.consultas).toHaveLength(2);
  });

  it("versión 0 y otra pestaña insertó primero: conflicto con el carrito actual", async () => {
    grabadora = dbGrabadora((c) => (tipo(c) === "select" ? [[[{ id: "9", qty: 1 }], 1]] : []));
    const r = await reemplazarCarrito("u1", 0, [{ id: "1", qty: 2 }]);
    expect(r).toEqual({ ok: false, actual: { items: [{ id: "9", qty: 1 }], version: 1 } });
    expect(grabadora.consultas.map(tipo)).toEqual(["update", "insert", "select"]);
  });

  it("versión > 0 sin fila: conflicto con carrito vacío en versión 0", async () => {
    const r = await reemplazarCarrito("u1", 3, [{ id: "1", qty: 2 }]);
    expect(r).toEqual({ ok: false, actual: { items: [], version: 0 } });
    expect(grabadora.consultas.map(tipo)).toEqual(["update", "select"]);
  });
});

describe("mergearCarrito", () => {
  it("asegura la fila, la bloquea, mergea por max y SIEMPRE sube la versión", async () => {
    grabadora = dbGrabadora((c) => {
      if (c.sql.includes("for update")) return [[[{ id: "1", qty: 2 }, { id: "2", qty: 1 }], 3]];
      if (tipo(c) === "update") return [[4]];
      return [];
    });
    const r = await mergearCarrito("u1", [{ id: "1", qty: 5 }, { id: "3", qty: 3 }]);
    expect(r).toEqual({
      items: [{ id: "1", qty: 5 }, { id: "2", qty: 1 }, { id: "3", qty: 3 }],
      version: 4,
      avisos: [],
    });

    const [ins, sel, upd] = grabadora.consultas;
    expect(grabadora.consultas).toHaveLength(3);
    expect(tipo(ins)).toBe("insert");
    expect(ins.sql).toMatch(/on conflict \("tenant_id","clerk_user_id"\) do nothing/);
    expect(valoresInsertados(ins).tenant_id).toBe("tenant-a");
    expect(valoresInsertados(ins).clerk_user_id).toBe("u1");

    expect(tipo(sel)).toBe("select");
    expect(sel.sql).toMatch(/for update$/);
    esperaDueno(sel);

    expect(tipo(upd)).toBe("update");
    esperaDueno(upd);
    expect(upd.sql).toMatch(SUBE_VERSION);
    expect(upd.params).toContain(json(r.items));
  });

  it("sin cambios igual sube la versión", async () => {
    grabadora = dbGrabadora((c) => {
      if (c.sql.includes("for update")) return [[[{ id: "1", qty: 5 }], 7]];
      if (tipo(c) === "update") return [[8]];
      return [];
    });
    const r = await mergearCarrito("u1", [{ id: "1", qty: 5 }]);
    expect(r.version).toBe(8);
    expect(grabadora.consultas.map(tipo)).toEqual(["insert", "select", "update"]);
  });
});

describe("vaciarCarritoTx", () => {
  it("vacía (no borra) y sube la versión, filtrando por tenant y usuario", async () => {
    // En producción recibe la transacción de `crearPedido`; acá, el cliente grabador.
    await vaciarCarritoTx(grabadora.db as unknown as Parameters<typeof vaciarCarritoTx>[0], "u1");
    expect(grabadora.consultas).toHaveLength(1);
    const [u] = grabadora.consultas;
    expect(tipo(u)).toBe("update");
    esperaDueno(u);
    expect(u.params).toContain("[]");
    expect(u.sql).toMatch(SUBE_VERSION);
  });
});

describe("enriquecer", () => {
  it("nombre, marca y precio del espejo; los faltantes quedan marcados", async () => {
    getProductosPorIds.mockResolvedValue(
      new Map([["1", { id: "1", name: "Lámpara", brand: "Marca", price: 150 }]]),
    );
    const r = await enriquecer(
      [
        { id: "1", qty: 2 },
        { id: "2", qty: 1 },
      ],
      "lista-7",
    );
    expect(getProductosPorIds).toHaveBeenCalledWith(["1", "2"], { idPriceList: "lista-7" });
    expect(r).toEqual([
      { id: "1", qty: 2, name: "Lámpara", brand: "Marca", price: 150 },
      { id: "2", qty: 1, name: "", brand: "", price: 0, faltante: true },
    ]);
  });

  it("carrito vacío no consulta", async () => {
    expect(await enriquecer([], undefined)).toEqual([]);
    expect(getProductosPorIds).not.toHaveBeenCalled();
  });
});
