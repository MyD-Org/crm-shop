import { describe, expect, it } from "vitest";
import { textoFaltanPorCantidad } from "./textos";

describe("textoFaltanPorCantidad", () => {
  it("singular y plural, en usted", () => {
    expect(textoFaltanPorCantidad({ pct: 10, faltan: 1 })).toBe("Agregue 1 unidad más y obtenga 10 % de descuento en todas.");
    expect(textoFaltanPorCantidad({ pct: 15, faltan: 3 })).toBe("Agregue 3 unidades más y obtenga 15 % de descuento en todas.");
  });
});
