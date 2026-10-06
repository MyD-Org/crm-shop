import { describe, expect, it } from "vitest";
import type { EvaluacionBusqueda } from "./banco";
import { reporteAmpliado } from "./banco";
import type { EvaluacionMedida } from "./medida-oraculo";
import { bloqueMedidas, resumenMedidas } from "./metricas-medida";
import { resumenNumerico } from "./metricas";

const medida = (p: Partial<EvaluacionMedida> = {}): EvaluacionMedida => ({
  hit: null,
  precision: null,
  contradicciones: 0,
  cobertura: 0,
  contradiccionesDuras: null,
  inversiones: null,
  contradicenArriba: null,
  falsoPositivo: null,
  detalle: [],
  ...p,
});

function ev(m?: Partial<EvaluacionMedida>, p: Partial<EvaluacionBusqueda> = {}): EvaluacionBusqueda {
  return {
    q: "consulta",
    diagnostico: false,
    intencionOk: null,
    categoriaOk: null,
    atributosOk: null,
    top24Ok: null,
    posicion: null,
    sinResultadosIndebido: false,
    puntos: 0,
    posibles: 0,
    total: 10,
    perfil: "particular",
    tipo: "medida",
    rr: null,
    precision: null,
    zero: false,
    ...(m ? { medida: medida(m) } : {}),
    ...p,
  };
}

describe("resumenMedidas", () => {
  it("sin ningún caso con medidas: undefined (el resumen numérico no cambia)", () => {
    expect(resumenMedidas([ev(), ev()])).toBeUndefined();
    expect(resumenNumerico([ev()], true)).not.toHaveProperty("medida");
  });

  it("promedia precisión y cobertura por caso; suma contradicciones; cuenta los n/a aparte", () => {
    const r = resumenMedidas([
      ev({ precision: 0.8, contradicciones: 2, cobertura: 0.5, hit: true }),
      ev({ precision: 1, contradicciones: 0, cobertura: 1, hit: false, contradiccionesDuras: 0 }),
      ev({ precision: null, contradicciones: 0, cobertura: 0, hit: true }),
    ])!;
    expect(r.n).toBe(3);
    expect(r.precision).toBeCloseTo(0.9, 10);
    expect(r.precisionExcluidos).toBe(1);
    expect(r.contradicciones).toBe(2);
    expect(r.contradiccionesDuras).toBe(0);
    expect(r.cobertura).toBeCloseTo(0.5, 10);
    expect(r.hitN).toBe(3);
    expect(r.hitRate).toBeCloseTo(2 / 3, 10);
  });

  it("hit null (la tubería no produce medidas) no entra al promedio de hit", () => {
    const r = resumenMedidas([ev({ precision: 1, cobertura: 1, hit: null }), ev({ precision: 1, cobertura: 1, hit: null })])!;
    expect(r.hitN).toBe(0);
    expect(r.hitRate).toBeNull();
  });

  it("contradicciones duras: suma sólo las que existen", () => {
    const r = resumenMedidas([ev({ precision: 1, cobertura: 1, contradiccionesDuras: 2 }), ev({ precision: 1, cobertura: 1, contradiccionesDuras: 1 }), ev({ precision: 1, cobertura: 1 })])!;
    expect(r.contradiccionesDuras).toBe(3);
  });

  it("inversiones: suma el orden de los casos que las tienen y cuenta los casos", () => {
    const r = resumenMedidas([
      ev({ precision: 1, cobertura: 1, inversiones: 4, contradicenArriba: 2 }),
      ev({ precision: 1, cobertura: 1, inversiones: 0, contradicenArriba: 0 }),
      ev({ precision: 1, cobertura: 1, inversiones: 1, contradicenArriba: 1 }),
      ev({ precision: 1, cobertura: 1 }),
    ])!;
    expect(r.inversiones).toBe(5);
    expect(r.casosConInversion).toBe(2);
    expect(r.contradicenArriba).toBe(3);
  });

  it("falsos positivos: sobre los negativos evaluables (los null no cuentan)", () => {
    const r = resumenMedidas([
      ev({ falsoPositivo: true, contradicciones: null, cobertura: null }),
      ev({ falsoPositivo: false, contradicciones: null, cobertura: null }),
      ev({ falsoPositivo: false, contradicciones: null, cobertura: null }),
      ev({ falsoPositivo: null, contradicciones: null, cobertura: null }),
    ])!;
    expect(r.negativos).toBe(3);
    expect(r.falsosPositivos).toBe(1);
    expect(r.falsosPositivosRate).toBeCloseTo(1 / 3, 10);
    // los negativos no tienen medidas esperadas: no cuentan como casos de precisión
    expect(r.n).toBe(0);
    expect(r.precision).toBeNull();
  });

  it("el resumen numérico lo expone en `medida`", () => {
    const r = resumenNumerico([ev({ precision: 0.5, cobertura: 0.25 })], true);
    expect(r.medida?.precision).toBe(0.5);
  });
});

describe("bloque «Medidas» del reporte ampliado", () => {
  it("no aparece si ningún caso tiene medidas (el reporte previo no cambia)", () => {
    expect(reporteAmpliado([ev()], true)).not.toContain("## Medidas");
  });

  it("aparece con total y tipo medida, sólo agregados", () => {
    const evs = [ev({ precision: 0.8, contradicciones: 2, cobertura: 0.4, hit: true }), ev({ falsoPositivo: true, contradicciones: null, cobertura: null }, { q: "DL-18W" })];
    const texto = reporteAmpliado(evs, true);
    expect(texto).toContain("## Medidas");
    expect(texto).toContain("medida-precision@24");
    expect(texto).toContain("contradicciones@24");
    expect(texto).toContain("cobertura@24");
    expect(texto).toContain("falsos positivos");
    expect(texto).toMatch(/total\s+\|/);
    expect(texto).toMatch(/medida\s+\|/);
    expect(texto).not.toContain("DL-18W");
  });

  it("bloqueMedidas formatea n/a como n/a y las tasas como %", () => {
    const lineas = bloqueMedidas([ev({ precision: null, cobertura: 0, contradicciones: 0 })]).join("\n");
    expect(lineas).toContain("n/a");
    const con = bloqueMedidas([ev({ precision: 0.75, cobertura: 0.5, contradicciones: 3, contradiccionesDuras: 1, hit: true })]).join("\n");
    expect(con).toContain("75.0%");
    expect(con).toContain("3 (1)");
    expect(bloqueMedidas([ev({ precision: 1, cobertura: 1, inversiones: 5 })]).join("\n")).toContain("inversiones@24");
    expect(bloqueMedidas([ev({ precision: 1, cobertura: 1, inversiones: 5 })]).join("\n")).toContain("5 (1)");
  });
});
