import { describe, expect, it } from "vitest";
import { PIE_TRANSFERENCIA } from "./pie-pago-transferencia";

describe("PIE_TRANSFERENCIA", () => {
  it("avisa que los datos para transferir aparecen al confirmar el pedido", () => {
    expect(PIE_TRANSFERENCIA).toBe("No se le cobra nada ahora. Al confirmar el pedido verá los datos para transferir.");
  });

  it("no repite el copy viejo y está en usted", () => {
    expect(PIE_TRANSFERENCIA).not.toContain("CBU");
    expect(PIE_TRANSFERENCIA).not.toMatch(/\b(vas|tenés|transferí|informá)\b/i);
  });
});
