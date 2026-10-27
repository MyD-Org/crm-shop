import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { leerModalidadesActivas, modalidadesActivas } from "./venta-sin-stock-repo";

vi.unmock("@/lib/venta-sin-stock-repo");

const FILA = (o: Partial<Record<string, unknown>> = {}) => ({
  id: "m1",
  nombre: "Interna",
  texto: "Modalidad 48 h",
  plazoDias: 2,
  flujo: "en_linea",
  ...o,
});

/** pg-proxy devuelve arrays en el orden de las columnas seleccionadas. */
const arr = (f: ReturnType<typeof FILA>) => [f.id, f.nombre, f.texto, f.plazoDias, f.flujo];

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("leerModalidadesActivas", () => {
  it("lee sólo las activas del tenant", async () => {
    const g = dbGrabadora(() => [arr(FILA())]);
    const r = await leerModalidadesActivas(g.db as never);
    expect(r).toEqual([{ id: "m1", nombre: "Interna", texto: "Modalidad 48 h", plazoDias: 2, flujo: "en_linea" }]);
    const [{ sql, params }] = g.consultas;
    expect(sql).toMatch(/from "public"\."modalidades_sin_stock"/);
    expect(sql).toMatch(/"tenant_id" = \$1/);
    expect(sql).toMatch(/"activa"/);
    expect(params).toEqual(["tenant-test", true]);
  });

  it("tabla ausente → [] y console.warn, sin tirar", async () => {
    const db = { select: () => { throw Object.assign(new Error("no existe"), { code: "42P01" }); } };
    expect(await leerModalidadesActivas(db as never)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[venta-sin-stock]"), expect.anything());
  });

  it("descarta filas con flujo o plazo inválidos", async () => {
    const g = dbGrabadora(() => [
      arr(FILA({ id: "ok1", plazoDias: null, flujo: "a_confirmar" })),
      arr(FILA({ id: "mal1", flujo: "raro" })),
      arr(FILA({ id: "mal2", plazoDias: 0 })),
      arr(FILA({ id: "mal3", plazoDias: 61 })),
      arr(FILA({ id: "ok2", plazoDias: 60 })),
    ]);
    const r = await leerModalidadesActivas(g.db as never);
    expect(r.map((m) => m.id)).toEqual(["ok1", "ok2"]);
  });
});

describe("modalidadesActivas", () => {
  it("no expone nombre", async () => {
    vi.resetModules();
    vi.doMock("@/db", () => ({ getDb: () => dbGrabadora(() => [arr(FILA())]).db }));
    const mod = await import("./venta-sin-stock-repo");
    const r = await mod.modalidadesActivas();
    expect(r).toEqual([{ id: "m1", texto: "Modalidad 48 h", plazoDias: 2, flujo: "en_linea" }]);
    expect("nombre" in r[0]).toBe(false);
    vi.doUnmock("@/db");
  });

  it("es una función exportada", () => {
    expect(typeof modalidadesActivas).toBe("function");
  });
});
