import { describe, expect, it } from "vitest";
import { CLAVE_PISTA, consumirPista } from "./pista";

const almacen = () => {
  const datos = new Map<string, string>();
  return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v), datos };
};

describe("consumirPista", () => {
  it("la primera vez sí (y la marca), después no", () => {
    const a = almacen();
    expect(consumirPista(a)).toBe(true);
    expect(a.datos.get(CLAVE_PISTA)).toBe("1");
    expect(consumirPista(a)).toBe(false);
  });

  it("sin almacenamiento o con uno que tira (modo privado), no se muestra", () => {
    expect(consumirPista(undefined)).toBe(false);
    const roto = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(consumirPista(roto)).toBe(false);
  });
});
