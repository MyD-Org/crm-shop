import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { atributosEstructuradosDisponibles, reiniciarDisponibilidadAtributos } from "./catalogo-atributos-disponibles";

/** Un `select` de drizzle falso: `.from().limit()` resuelve o tira como la base. */
function dbQue(resultado: "ok" | Error) {
  const limit = vi.fn(async () => {
    if (resultado instanceof Error) throw resultado;
    return [];
  });
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  return { db: { select } as never, select };
}

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  reiniciarDisponibilidadAtributos();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("atributosEstructuradosDisponibles", () => {
  it("el SQL real: las 5 columnas concedidas, con el tenant y LIMIT 0", async () => {
    const g = dbGrabadora();
    expect(await atributosEstructuradosDisponibles(g.db as never, 0)).toBe(true);
    const [{ sql, params }] = g.consultas;
    expect(sql).toMatch(/from "public"\."catalog_atributos" where "public"\."catalog_atributos"\."tenant_id" = \$1 limit \$2/);
    expect(sql).not.toMatch(/fuente|updated_at/);
    expect(params).toEqual(["tenant-test", 0]);
    reiniciarDisponibilidadAtributos();
  });

  it("la tabla responde ⇒ true", async () => {
    expect(await atributosEstructuradosDisponibles(dbQue("ok").db, 0)).toBe(true);
  });

  it("sin la migración (42P01) o sin permiso (42501) ⇒ false, sin tirar", async () => {
    const err = Object.assign(new Error('relation "public.catalog_atributos" does not exist'), { code: "42P01" });
    expect(await atributosEstructuradosDisponibles(dbQue(err).db, 0)).toBe(false);
  });

  it("recuerda la respuesta 5 minutos y después vuelve a preguntar (la migración se aplica sin redeploy)", async () => {
    const falla = dbQue(new Error("no existe"));
    expect(await atributosEstructuradosDisponibles(falla.db, 0)).toBe(false);
    const ok = dbQue("ok");
    expect(await atributosEstructuradosDisponibles(ok.db, 60_000)).toBe(false);
    expect(ok.select).not.toHaveBeenCalled();
    expect(await atributosEstructuradosDisponibles(ok.db, 5 * 60_000 + 1)).toBe(true);
  });
});
