import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { leerModalidadesActivas, modalidadesActivas } from "./venta-sin-stock-repo";

vi.unmock("@/lib/venta-sin-stock-repo");

const { cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({ cacheLifeMock: vi.fn(), cacheTagMock: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock, cacheTag: cacheTagMock }));

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
  vi.clearAllMocks();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sin permiso (42501, envuelto por drizzle en `cause`) → [] y console.warn", async () => {
    const envuelto = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("permission denied"), { code: "42501" }),
    });
    const db = { select: () => { throw envuelto; } };
    expect(await leerModalidadesActivas(db as never)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[venta-sin-stock]"), expect.anything());
    expect(console.error).not.toHaveBeenCalled();
  });

  it("otro error (base caída) → [] pero console.error, sin tirar", async () => {
    const db = { select: () => { throw new Error("connection refused"); } };
    expect(await leerModalidadesActivas(db as never)).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[venta-sin-stock]"), "connection refused");
    expect(console.warn).not.toHaveBeenCalled();
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

describe("modalidadesActivas (caché `catalogo`)", () => {
  async function conDb(responder: () => unknown) {
    vi.resetModules();
    vi.doMock("@/db", () => ({ getDb: () => dbGrabadora(responder as never).db }));
    const mod = await import("./venta-sin-stock-repo");
    vi.doUnmock("@/db");
    return mod;
  }

  it("no expone nombre, con el tag y el perfil del catálogo", async () => {
    const mod = await conDb(() => [arr(FILA())]);
    const r = await mod.modalidadesActivas();
    expect(r).toEqual([{ id: "m1", texto: "Modalidad 48 h", plazoDias: 2, flujo: "en_linea" }]);
    expect("nombre" in r[0]).toBe(false);
    expect(cacheTagMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
  });

  it("si la lectura falla: [] con el perfil degradado (no se guarda por 15 minutos)", async () => {
    const mod = await conDb(() => {
      throw new Error("connection refused");
    });
    expect(await mod.modalidadesActivas()).toEqual([]);
    expect(cacheTagMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock).toHaveBeenCalledWith("degradado");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("catalogo");
    expect(console.error).toHaveBeenCalled();
  });

  it("sin la migración 0094 (42P01): [] con la vida del catálogo (no acorta las entradas que la anidan)", async () => {
    const mod = await conDb(() => {
      throw Object.assign(new Error("no existe"), { code: "42P01" });
    });
    expect(await mod.modalidadesActivas()).toEqual([]);
    expect(cacheLifeMock).toHaveBeenCalledWith("catalogo");
    expect(cacheLifeMock).not.toHaveBeenCalledWith("degradado");
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("es una función exportada", () => {
    expect(typeof modalidadesActivas).toBe("function");
  });
});
