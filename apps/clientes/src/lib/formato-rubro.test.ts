import { describe, expect, it } from "vitest";
import { formatRubro } from "./formato-rubro";

describe("formatRubro", () => {
  it("pasa a título un rubro en mayúsculas sin acentos", () => {
    expect(formatRubro("ELECTRICIDAD")).toBe("Electricidad");
    expect(formatRubro("ILUMINACION")).toBe("Iluminación");
    expect(formatRubro("AUTOMATIZACION")).toBe("Automatización");
  });

  it("conserva las siglas en mayúscula", () => {
    expect(formatRubro("LAMPARAS LED")).toBe("Lámparas LED");
    expect(formatRubro("ILUMINACION LED EXTERIOR")).toBe(
      "Iluminación LED Exterior",
    );
  });

  it("acepta las dos grafías de automaticación", () => {
    expect(formatRubro("AUTOMATICACION")).toBe("Automatización");
    expect(formatRubro("AUTOMATIZACION")).toBe("Automatización");
  });

  it("deja intacto un label que ya viene bien", () => {
    expect(formatRubro("Fuentes Switching")).toBe("Fuentes Switching");
  });

  it("es idempotente: formatear dos veces da lo mismo", () => {
    for (const rubro of [
      "ELECTRICIDAD",
      "LAMPARAS LED",
      "ILUMINACION LED EXTERIOR",
    ]) {
      expect(formatRubro(formatRubro(rubro))).toBe(formatRubro(rubro));
    }
  });
});
