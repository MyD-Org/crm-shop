import { describe, expect, it } from "vitest";
import {
  esFechaIso,
  paramsFacturas,
  paramsPagos,
  paramsPresupuestos,
  RANGO_INVALIDO,
  startSeguro,
} from "./filtros";

const p = (q: string) => paramsFacturas(new URLSearchParams(q));

describe("startSeguro (FAC-2: start inválido ⇒ 0)", () => {
  it.each([
    [null, 0],
    ["", 0],
    ["-5", 0],
    ["abc", 0],
    ["1.5", 0],
    ["30", 30],
  ])("%s → %s", (raw, esperado) => {
    expect(startSeguro(raw)).toBe(esperado);
  });
});

describe("esFechaIso", () => {
  it("sólo días que existen", () => {
    expect(esFechaIso("2026-09-23")).toBe(true);
    expect(esFechaIso("2026-02-30")).toBe(false);
    expect(esFechaIso("23/09/2026")).toBe(false);
    expect(esFechaIso("2026-9-3")).toBe(false);
  });
});

describe("paramsFacturas", () => {
  it("estados como el portal: pendiente y vencida son open; pagada closed; anulada void", () => {
    expect(p("estado=pendiente")).toMatchObject({ filtros: { status: "open" } });
    expect(p("estado=vencida")).toMatchObject({ filtros: { status: "open" } });
    expect(p("estado=pagada")).toMatchObject({ filtros: { status: "closed" } });
    expect(p("estado=anulada")).toMatchObject({ filtros: { status: "void" } });
  });

  it("estado desconocido ⇒ todas", () => {
    expect(p("estado=borrador")).toEqual({ start: 0, filtros: {} });
    expect(p("estado=toString")).toEqual({ start: 0, filtros: {} });
  });

  it("fechas de emisión y start", () => {
    expect(p("start=30&desde=2026-01-01&hasta=2026-06-30")).toEqual({
      start: 30,
      filtros: { dateFrom: "2026-01-01", dateTo: "2026-06-30" },
    });
  });

  it("FAC-3: fecha inválida o desde > hasta ⇒ error en usted", () => {
    expect(p("desde=2026-13-01")).toEqual({ error: RANGO_INVALIDO });
    expect(p("hasta=ayer")).toEqual({ error: RANGO_INVALIDO });
    expect(p("desde=2026-06-30&hasta=2026-01-01")).toEqual({ error: RANGO_INVALIDO });
    expect(RANGO_INVALIDO).toBe("Revise el rango de fechas.");
  });

  it("un client_id en el query no llega a los filtros (ACC-3)", () => {
    expect(p("client_id=99")).toEqual({ start: 0, filtros: {} });
  });
});

describe("paramsPagos (PAG-1: sin filtros de fecha)", () => {
  it("sólo start; lo demás se ignora", () => {
    expect(paramsPagos(new URLSearchParams("start=10&desde=2026-01-01&client_id=9"))).toEqual({ start: 10 });
    expect(paramsPagos(new URLSearchParams("start=-3"))).toEqual({ start: 0 });
  });
});

describe("paramsPresupuestos (PRE-1)", () => {
  const pp = (q: string) => paramsPresupuestos(new URLSearchParams(q));

  it("Aceptados = billed, Sin aceptar = unbilled, desconocido = todos", () => {
    expect(pp("estado=aceptado")).toEqual({ start: 0, filtros: { status: "billed" } });
    expect(pp("estado=sin_aceptar&start=30")).toEqual({ start: 30, filtros: { status: "unbilled" } });
    expect(pp("estado=vigente")).toEqual({ start: 0, filtros: {} });
    expect(pp("estado=__proto__")).toEqual({ start: 0, filtros: {} });
  });

  it("rango de emisión; inválido o invertido ⇒ error en usted", () => {
    expect(pp("desde=2026-01-01&hasta=2026-01-31")).toEqual({
      start: 0,
      filtros: { dateFrom: "2026-01-01", dateTo: "2026-01-31" },
    });
    expect(pp("desde=2026-02-01&hasta=2026-01-01")).toEqual({ error: RANGO_INVALIDO });
    expect(pp("hasta=31/01/2026")).toEqual({ error: RANGO_INVALIDO });
  });
});
