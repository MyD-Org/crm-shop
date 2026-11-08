import { describe, expect, it } from "vitest";
import { DECORACION_POR_DEFECTO, KEY_DECORACION, resolverDecoracion, validarDecoracion } from "./decoracion";

describe("decoración del sitio (textura de piedra)", () => {
  it("la clave de home_content es `decoracion` y por defecto la piedra está apagada", () => {
    expect(KEY_DECORACION).toBe("decoracion");
    expect(DECORACION_POR_DEFECTO).toEqual({ piedra: false });
  });

  it("sólo `piedra: true` exacto la enciende; todo lo demás es falso", () => {
    expect(resolverDecoracion({ piedra: true })).toEqual({ piedra: true });
    expect(resolverDecoracion({ piedra: false })).toEqual({ piedra: false });
    for (const raro of [undefined, null, "x", 1, true, [], {}, { piedra: "true" }, { piedra: 1 }, { piedra: null }, [{ piedra: true }]]) {
      expect(resolverDecoracion(raro)).toEqual({ piedra: false });
    }
  });

  it("no arrastra campos desconocidos", () => {
    expect(resolverDecoracion({ piedra: true, otra: 1 })).toEqual({ piedra: true });
  });

  it("validar acepta un booleano y rechaza el resto", () => {
    expect(validarDecoracion({ piedra: true })).toEqual({ ok: true, datos: { piedra: true } });
    expect(validarDecoracion({ piedra: false })).toEqual({ ok: true, datos: { piedra: false } });
    for (const malo of [null, undefined, [], "x", {}, { piedra: "si" }, { piedra: 1 }]) {
      const r = validarDecoracion(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errores.length).toBeGreaterThan(0);
    }
  });
});
