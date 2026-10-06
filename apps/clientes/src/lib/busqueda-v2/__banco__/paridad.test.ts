import { describe, expect, it } from "vitest";
import type { ReporteJson } from "./corrida";
import { compararParidad, formatearParidad, idsDeReporte } from "./paridad";

const caso = (ids: string[], total = ids.length) => ({ ids, total });

describe("compararParidad", () => {
  it("corridas idénticas: cero diferencias", () => {
    const a = [caso(["1", "2", "3"], 40), caso([], 0)];
    expect(compararParidad(a, structuredClone(a), { n: 24, conteo: true })).toEqual({ n: 24, casos: 2, diferencias: [] });
  });

  it("distintos productos en el top-N: motivo ids", () => {
    const r = compararParidad([caso(["1", "2"])], [caso(["1", "9"])], { n: 24, conteo: false });
    expect(r.diferencias).toEqual([{ idx: 0, motivo: "ids" }]);
  });

  it("mismos productos en otro orden: motivo orden", () => {
    const r = compararParidad([caso(["1", "2", "3"])], [caso(["2", "1", "3"])], { n: 24, conteo: false });
    expect(r.diferencias).toEqual([{ idx: 0, motivo: "orden" }]);
  });

  it("sólo cuenta el top-N: lo que viene después no es una diferencia", () => {
    const r = compararParidad([caso(["1", "2", "3"])], [caso(["1", "2", "9"])], { n: 2, conteo: false });
    expect(r.diferencias).toEqual([]);
  });

  it("distinto largo dentro del top-N: ids", () => {
    const r = compararParidad([caso(["1", "2"])], [caso(["1"])], { n: 8, conteo: false });
    expect(r.diferencias).toEqual([{ idx: 0, motivo: "ids" }]);
  });

  it("el total sólo se compara en las superficies que cuentan", () => {
    const a = [caso(["1"], 5)];
    const b = [caso(["1"], 6)];
    expect(compararParidad(a, b, { n: 24, conteo: false }).diferencias).toEqual([]);
    expect(compararParidad(a, b, { n: 24, conteo: true }).diferencias).toEqual([{ idx: 0, motivo: "total" }]);
  });

  it("ids tiene prioridad sobre orden y total", () => {
    const r = compararParidad([caso(["1", "2"], 5)], [caso(["2", "9"], 6)], { n: 24, conteo: true });
    expect(r.diferencias).toEqual([{ idx: 0, motivo: "ids" }]);
  });

  it("una corrida con menos casos que la otra: cada faltante es una diferencia", () => {
    const r = compararParidad([caso(["1"]), caso(["2"])], [caso(["1"])], { n: 24, conteo: false });
    expect(r).toMatchObject({ casos: 2, diferencias: [{ idx: 1, motivo: "ids" }] });
  });

  it("informa todas las diferencias, con su índice", () => {
    const a = [caso(["1"]), caso(["2"]), caso(["3"])];
    const b = [caso(["9"]), caso(["2"]), caso(["8"])];
    expect(compararParidad(a, b, { n: 24, conteo: false }).diferencias.map((d) => d.idx)).toEqual([0, 2]);
  });
});

describe("idsDeReporte", () => {
  const reporte = (casos: Partial<ReporteJson["casos"][number]>[]) => ({ casos }) as unknown as ReporteJson;

  it("toma ids y total de cada caso", () => {
    expect(idsDeReporte(reporte([{ ids: ["a", "b"], total: 7 }, { ids: [], total: 0 }]))).toEqual([caso(["a", "b"], 7), caso([], 0)]);
  });

  it("sin ids (corrida sin --ids) explica qué hacer", () => {
    expect(() => idsDeReporte(reporte([{ total: 1 }]))).toThrow(/--ids/);
  });
});

describe("formatearParidad", () => {
  it("cero diferencias: lo dice y sale bien", () => {
    const t = formatearParidad({ n: 10, casos: 5, diferencias: [] }, { enmascarar: true });
    expect(t).toMatch(/0 diferencias/);
    expect(t).toMatch(/5 casos/);
  });

  it("lista cada diferencia por índice y motivo; nunca ids ni consultas", () => {
    const t = formatearParidad({ n: 10, casos: 5, diferencias: [{ idx: 3, motivo: "orden" }, { idx: 4, motivo: "ids" }] }, { enmascarar: true });
    expect(t).toMatch(/2 diferencias/);
    expect(t).toContain("#3 (orden)");
    expect(t).toContain("#4 (ids)");
  });

  it("con consultas visibles (banco versionado) las muestra", () => {
    const t = formatearParidad({ n: 10, casos: 2, diferencias: [{ idx: 1, motivo: "ids" }] }, { enmascarar: false, consultas: ["uno", "dos"] });
    expect(t).toContain("#1 «dos» (ids)");
  });
});
