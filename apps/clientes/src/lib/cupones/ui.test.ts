import { describe, expect, it } from "vitest";
import { avisoCuponGuardado } from "./ui";

describe("textos del cupón en la tienda", () => {
  it("avisoCuponGuardado: el código en mayúsculas, en usted", () => {
    expect(avisoCuponGuardado("luz-7kq2m")).toBe("Cupón LUZ-7KQ2M guardado: se aplica en el checkout.");
  });
});
