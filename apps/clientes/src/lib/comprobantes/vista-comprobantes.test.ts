import { describe, expect, it } from "vitest";
import {
  LABEL_ESTADO_COMPROBANTE,
  OPCIONES_MEDIO,
  TONO_ESTADO_COMPROBANTE,
  fechaCorta,
  medioDe,
  montoDe,
} from "./vista-comprobantes";

describe("vista de comprobantes (CMP-4)", () => {
  it("estados visibles: En revisión / Registrado", () => {
    expect(LABEL_ESTADO_COMPROBANTE).toEqual({ pending: "En revisión", loaded: "Registrado" });
    expect(TONO_ESTADO_COMPROBANTE).toEqual({ pending: "warning", loaded: "success" });
  });

  it("medios en el orden del portal; 'otro' muestra el detalle", () => {
    expect(OPCIONES_MEDIO.map((o) => o.value)).toEqual(["transferencia", "cheque", "efectivo", "otro"]);
    expect(medioDe({ method: "otro", methodOther: "Mercado Pago" })).toBe("Otro (Mercado Pago)");
    expect(medioDe({ method: "cheque", methodOther: null })).toBe("Cheque");
  });

  it("fechas y montos", () => {
    expect(fechaCorta("2026-09-10")).toBe("10/09/2026");
    expect(fechaCorta("2026-09-12T13:00:00.000Z")).toBe("12/09/2026");
    expect(montoDe({ amount: "150000.50" })).toBe(150000.5);
  });
});
