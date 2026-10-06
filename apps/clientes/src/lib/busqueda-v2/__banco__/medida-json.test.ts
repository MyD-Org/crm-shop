import { describe, expect, it } from "vitest";
import type { EvaluacionMedida } from "./medida-oraculo";
import { medidaParaJson } from "./medida-json";

const ev = (p: Partial<EvaluacionMedida> = {}): EvaluacionMedida => ({
  hit: true,
  precision: 0.8,
  contradicciones: 2,
  cobertura: 0.5,
  contradiccionesDuras: 2,
  inversiones: 3,
  contradicenArriba: 2,
  falsoPositivo: null,
  emitidas: ["polos:2", "corriente_a:20"],
  emitidasDuras: ["polos:2"],
  detalle: [
    { clave: "polos", valor: "2", dura: true, con: 10, cumple: 8, contradice: 2, duras: 2, inversiones: 3, arriba: 2, contradicen: ["p1", "p2"] },
    { clave: "corriente_a", valor: "20", dura: false, con: 4, cumple: 4, contradice: 0, duras: 0, inversiones: 0, arriba: 0, contradicen: [] },
  ],
  ...p,
});

describe("medidaParaJson", () => {
  it("compacto: ids del plan, duros, hit y los conteos por medida esperada; sin ids de producto por defecto", () => {
    const j = medidaParaJson(ev(), { enmascarar: false, ids: false, pagina: 24 });
    expect(j).toEqual({
      hit: true,
      falsoPositivo: null,
      pagina: 24,
      plan: ["polos:2", "corriente_a:20"],
      duros: ["polos:2"],
      esperadas: [
        { clave: "polos", valor: "2", dura: true, con: 10, cumple: 8, contradice: 2, duras: 2, inversiones: 3, arriba: 2 },
        { clave: "corriente_a", valor: "20", dura: false, con: 4, cumple: 4, contradice: 0, duras: 0, inversiones: 0, arriba: 0 },
      ],
    });
    expect(JSON.stringify(j)).not.toContain("p1");
  });

  it("--ids suma los ids de los productos que contradicen (sólo si hay)", () => {
    const j = medidaParaJson(ev(), { enmascarar: false, ids: true, pagina: 24 });
    expect(j.esperadas[0].contradicen).toEqual(["p1", "p2"]);
    expect(j.esperadas[1]).not.toHaveProperty("contradicen");
  });

  it("banco enmascarado: el plan queda en claves (sin valores) y se omite el valor esperado", () => {
    const j = medidaParaJson(ev({ emitidas: ["polos:2", "zocalo-e27", "otro"], emitidasDuras: ["zocalo-e27"] }), { enmascarar: true, ids: false, pagina: 24 });
    expect(j.plan).toEqual(["polos", "zocalo", "otro"]);
    expect(j.duros).toEqual(["zocalo"]);
    expect(j.esperadas.every((e) => !("valor" in e))).toBe(true);
    expect(JSON.stringify(j)).not.toContain("polos:2");
    expect(JSON.stringify(j)).not.toContain("e27");
  });

  it("tubería sin medidas: plan y duros ausentes", () => {
    const j = medidaParaJson(ev({ hit: null, emitidas: undefined, emitidasDuras: undefined }), { enmascarar: false, ids: false, pagina: 3 });
    expect(j).not.toHaveProperty("plan");
    expect(j).not.toHaveProperty("duros");
    expect(j.pagina).toBe(3);
  });
});
