import { describe, expect, it } from "vitest";
import { precioFinal } from "./precio-final";

/**
 * Precio final con IVA que se exhibe (Ley 27.743 / Res. 4/2025). Tiene que ser
 * el mismo número que cobra la cotización para cantidad 1, que redondea el
 * neto y el IVA por separado al centavo.
 */
describe("precioFinal", () => {
  it("suma el IVA al precio neto", () => {
    expect(precioFinal(100000, 21)).toBe(121000);
    expect(precioFinal(100000, 10.5)).toBe(110500);
    expect(precioFinal(100000, 0)).toBe(100000);
  });

  it("redondea igual que la cotización (neto e IVA por separado)", () => {
    // 1234.565 → neto 1234.57; IVA 21% de 1234.57 = 259.2597 → 259.26
    expect(precioFinal(1234.565, 21)).toBe(1493.83);
  });

  it("undefined si no hay IVA persistido o el precio no sirve", () => {
    expect(precioFinal(100000, null)).toBeUndefined();
    expect(precioFinal(100000, undefined)).toBeUndefined();
    expect(precioFinal(100000, Number.NaN)).toBeUndefined();
    expect(precioFinal(0, 21)).toBeUndefined();
  });
});
