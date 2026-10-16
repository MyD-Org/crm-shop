import { describe, it, expect, beforeEach, vi } from "vitest";
import { fieldsDeSpec, reiniciarSpecs } from "./catalogo-specs";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  reiniciarSpecs();
});

describe("fieldsDeSpec", () => {
  it("consulta catalog_specs filtrando por tenant y devuelve fields", async () => {
    const { db, consultas } = dbGrabadora(() => [[{ fields: { haz_grados: { etiqueta: "Haz" } } }]]);
    expect(await fieldsDeSpec("atributos_tecnicos", db as never)).toEqual({ haz_grados: { etiqueta: "Haz" } });
    expect(consultas[0].sql).toMatch(/"public"\."catalog_specs"/);
    expect(consultas[0].sql).toMatch(/"tenant_id" = \$1/);
    expect(consultas[0].params).toContain("tenant-test");
  });

  it("sin tabla o sin permiso devuelve null, avisa una sola vez y no tira", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => { throw new Error('relation "catalog_specs" does not exist'); } }) }) }) };
    expect(await fieldsDeSpec("atributos_tecnicos", db as never, 0)).toBeNull();
    expect(await fieldsDeSpec("otra", db as never, 1)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("memoiza 5 minutos", async () => {
    const g = dbGrabadora(() => [[{ fields: { a: { etiqueta: "A" } } }]]);
    await fieldsDeSpec("s", g.db as never, 0);
    await fieldsDeSpec("s", g.db as never, 60_000);
    expect(g.consultas).toHaveLength(1);
    await fieldsDeSpec("s", g.db as never, 6 * 60_000);
    expect(g.consultas).toHaveLength(2);
  });
});
