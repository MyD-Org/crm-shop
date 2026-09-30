import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  busquedasFrecuentes,
  comoResultado,
  guardarInterpretacion,
  hashArbol,
  leerInterpretacion,
  MIN_USOS_FRECUENTE,
  reiniciarAvisoCache,
} from "./cache";

beforeEach(() => {
  grabadora = dbGrabadora();
});

const resultado = { aplicar: { categorias: ["Reflectores"], atributos: ["tono-calido"], q: "50w" }, sugerir: { categorias: [], atributos: [] } };

describe("hashArbol", () => {
  const arbol = [
    { id: "a", parentId: null, nombre: "Iluminación", orden: 1 },
    { id: "b", parentId: "a", nombre: "Reflectores", orden: 1 },
  ];

  it("no depende del orden y cambia si cambia un nombre", () => {
    expect(hashArbol(arbol)).toBe(hashArbol([...arbol].reverse()));
    expect(hashArbol(arbol)).not.toBe(hashArbol([arbol[0], { ...arbol[1], nombre: "Proyectores" }]));
    expect(hashArbol(arbol).length).toBeLessThanOrEqual(64);
  });
});

describe("lectura, escritura y frecuentes", () => {
  it("leer suma un uso en la misma consulta (update … returning) y filtra por la clave", async () => {
    grabadora = dbGrabadora(() => [[resultado, "jev"]]);
    expect(await leerInterpretacion("t1", "reflector calido", "h")).toEqual({ resultado, fuente: "jev" });
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^update "shop"\."busqueda_interpretaciones" set "hits" = "shop"\."busqueda_interpretaciones"\."hits" \+ 1/);
    expect(c.sql).toContain("returning");
    expect(c.params).toEqual(expect.arrayContaining(["t1", "reflector calido", "h"]));
  });

  it("sin fila ⇒ null", async () => {
    expect(await leerInterpretacion("t1", "x", "h")).toBeNull();
  });

  it("guardar es un upsert por la clave", async () => {
    await guardarInterpretacion("t1", "reflector calido", "h", { resultado, fuente: "deterministico" });
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^insert into "shop"\."busqueda_interpretaciones"/);
    expect(c.sql).toContain('on conflict ("tenant_id","consulta_norm","arbol_hash") do update');
  });

  it("frecuentes: 30 días, resultado no vacío, mínimo de usos, más usadas primero", async () => {
    grabadora = dbGrabadora(() => [["luz calida", 12], ["reflector exterior", 5]]);
    expect(await busquedasFrecuentes("t1", 4)).toEqual(["luz calida", "reflector exterior"]);
    const [c] = grabadora.consultas;
    expect(c.sql).toContain("make_interval(days =>");
    expect(c.sql).toContain("jsonb_array_length");
    expect(c.sql).toMatch(/having sum\(.*\)::int >= \$\d+/);
    expect(c.params).toContain(MIN_USOS_FRECUENTE);
    expect(c.sql).toMatch(/order by sum\(.*\)::int desc/);
  });

  it("si la tabla no existe (o la base falla), nada se rompe y se avisa una sola vez (warn)", async () => {
    reiniciarAvisoCache();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    grabadora = dbGrabadora((): never => {
      throw Object.assign(new Error('relation "shop.busqueda_interpretaciones" does not exist'), { name: "PostgresError" });
    });
    await expect(leerInterpretacion("t1", "consulta privada", "h")).resolves.toBeNull();
    await expect(guardarInterpretacion("t1", "consulta privada", "h", { resultado, fuente: "jev" })).resolves.toBeUndefined();
    await expect(busquedasFrecuentes("t1")).resolves.toEqual([]);
    await leerInterpretacion("t1", "otra consulta", "h");
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    for (const [msg] of log.mock.calls) expect(String(msg)).not.toContain("consulta privada");
    log.mockRestore();
    error.mockRestore();
  });
});

describe("comoResultado", () => {
  it("una fila vieja o rota queda con la forma segura", () => {
    expect(comoResultado(null)).toEqual({ aplicar: { categorias: [], atributos: [] }, sugerir: { categorias: [], atributos: [] } });
    expect(comoResultado({ aplicar: { categorias: ["A", 3], q: "" }, sugerir: "x" })).toEqual({
      aplicar: { categorias: ["A"], atributos: [] },
      sugerir: { categorias: [], atributos: [] },
    });
  });
});

describe("contrato de la tabla con la migración 0025", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../../drizzle/0025_busqueda_interpretaciones.sql", import.meta.url)), "utf8");

  it("crea la tabla con la clave y las columnas que usa el código", () => {
    for (const col of ["tenant_id", "consulta_norm", "arbol_hash", "resultado", "fuente", "hits", "created_at", "last_used_at"]) {
      expect(sql).toContain(`"${col}"`);
    }
    expect(sql).toContain('PRIMARY KEY("tenant_id","consulta_norm","arbol_hash")');
  });

  it("GRANT condicional a shop_app sin DELETE", () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON "shop"\."busqueda_interpretaciones" TO shop_app/);
    expect(sql).not.toMatch(/GRANT [A-Z, ]*DELETE[A-Z, ]* ON/);
  });
});

describe("lectura sin sumar uso", () => {
  it("la página ya interpretada sólo lee (select), no actualiza", async () => {
    grabadora = dbGrabadora(() => [[resultado, "deterministico"]]);
    expect(await leerInterpretacion("t1", "x", "h", false)).toEqual({ resultado, fuente: "deterministico" });
    expect(grabadora.consultas[0].sql).toMatch(/^select /);
  });
});
