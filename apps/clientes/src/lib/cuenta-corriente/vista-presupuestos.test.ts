import { describe, expect, it } from "vitest";
import {
  LABEL_ESTADO_PRESUPUESTO,
  OPCIONES_PRESUPUESTO,
  TONO_ESTADO_PRESUPUESTO,
  esFiltroPresupuestos,
  queryPresupuestos,
  resumenImputaciones,
} from "./vista-presupuestos";

describe("filtro de presupuestos (PRE-1)", () => {
  it("Todos / Aceptados / Sin aceptar, en ese orden", () => {
    expect(OPCIONES_PRESUPUESTO.map((o) => o.label)).toEqual(["Todos", "Aceptados", "Sin aceptar"]);
    expect(esFiltroPresupuestos("sin_aceptar")).toBe(true);
    expect(esFiltroPresupuestos("vigente")).toBe(false);
  });

  it("query: sólo lo que filtra; todos sin estado", () => {
    expect(queryPresupuestos("todos", {})).toBe("");
    expect(queryPresupuestos("sin_aceptar", { start: "2026-01-01" }, 30)).toBe(
      "?start=30&estado=sin_aceptar&desde=2026-01-01",
    );
    expect(queryPresupuestos("aceptado", { end: "2026-06-30" })).toBe("?estado=aceptado&hasta=2026-06-30");
  });
});

describe("estado de presupuesto", () => {
  it("labels y tonos del DS", () => {
    expect(LABEL_ESTADO_PRESUPUESTO).toEqual({ vigente: "Vigente", vencido: "Vencido", aceptado: "Aceptado" });
    expect(TONO_ESTADO_PRESUPUESTO).toEqual({ aceptado: "success", vigente: "info", vencido: "neutral" });
  });
});

describe("pagos", () => {
  it("resumenImputaciones: la primera factura y cuántas más", () => {
    expect(resumenImputaciones({ facturas: [] })).toEqual({ primera: "—", mas: 0 });
    expect(
      resumenImputaciones({
        facturas: [
          { factura: "F1", imputado: 200 },
          { factura: "F2", imputado: 100 },
        ],
      }),
    ).toEqual({ primera: "F1", mas: 1 });
  });
});
