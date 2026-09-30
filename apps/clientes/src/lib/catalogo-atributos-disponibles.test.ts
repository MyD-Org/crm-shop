import { beforeEach, describe, expect, it, vi } from "vitest";
import { atributosEstructuradosDisponibles, reiniciarDisponibilidadAtributos } from "./catalogo-atributos-disponibles";

/** Un `select` de drizzle falso: `.from().limit()` resuelve o tira como la base. */
function dbQue(resultado: "ok" | Error) {
  const limit = vi.fn(async () => {
    if (resultado instanceof Error) throw resultado;
    return [];
  });
  const select = vi.fn(() => ({ from: () => ({ limit }) }));
  return { db: { select } as never, select };
}

beforeEach(() => {
  reiniciarDisponibilidadAtributos();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("atributosEstructuradosDisponibles", () => {
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
