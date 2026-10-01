import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import {
  PIE_TRANSFERENCIA_CON_CUENTA,
  PIE_TRANSFERENCIA_SIN_CUENTA,
  pieTransferencia,
} from "./pie-pago-transferencia";

describe("pieTransferencia", () => {
  it("con cuenta resuelta: indica transferir a la cuenta y avisar el pago desde Mis pedidos", () => {
    expect(pieTransferencia(true)).toBe(
      "No se le cobra nada ahora. Transfiera a la cuenta indicada y luego informe el pago desde Mis pedidos.",
    );
  });

  it("sin cuenta: promete enviar los datos", () => {
    expect(pieTransferencia(false)).toBe("No se le cobra nada ahora. Le enviaremos los datos para transferir.");
  });

  it("no repite el copy viejo y está en usted", () => {
    for (const t of [PIE_TRANSFERENCIA_CON_CUENTA, PIE_TRANSFERENCIA_SIN_CUENTA]) {
      expect(t).not.toContain("Coordinamos el pago");
      expect(infracciones(t, REGISTRO)).toEqual([]);
    }
  });
});
