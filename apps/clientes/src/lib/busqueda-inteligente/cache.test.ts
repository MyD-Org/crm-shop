import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  busquedasFrecuentes,
  hashArbol,
  MIN_USOS_FRECUENTE,
} from "./cache";

beforeEach(() => {
  grabadora = dbGrabadora();
});

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

describe("frecuentes", () => {
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    grabadora = dbGrabadora((): never => {
      throw Object.assign(new Error('relation "shop.busqueda_interpretaciones" does not exist'), { name: "PostgresError" });
    });
    await expect(busquedasFrecuentes("t1")).resolves.toEqual([]);
    await busquedasFrecuentes("t2");
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    for (const [msg] of log.mock.calls) expect(String(msg)).not.toContain("consulta privada");
    log.mockRestore();
    error.mockRestore();
  });
});

describe("contrato de la tabla con la migración 0026", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../../drizzle/0026_busqueda_interpretaciones.sql", import.meta.url)), "utf8");

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
