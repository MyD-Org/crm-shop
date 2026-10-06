import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvaluacionBusqueda } from "./banco";
import { compararMatrices, leerSnapshot, parsearSnapshot, type MatrizJson } from "./comparar";
import type { Cabecera, ReporteJson } from "./corrida";
import { cortarPor, resumenNumerico } from "./metricas";
import type { EvaluacionMedida } from "./medida-oraculo";

const medida = (p: Partial<EvaluacionMedida>): EvaluacionMedida => ({ hit: null, precision: null, contradicciones: 0, cobertura: 0, contradiccionesDuras: null, inversiones: null, contradicenArriba: null, falsoPositivo: null, detalle: [], ...p });

function ev(i: number, p: Partial<EvaluacionBusqueda> = {}): EvaluacionBusqueda {
  return {
    q: `#${i}`, diagnostico: false, intencionOk: null, categoriaOk: null, atributosOk: null, top24Ok: true, posicion: 1, sinResultadosIndebido: false,
    puntos: 0, posibles: 0, total: 5, perfil: "desconocido", tipo: "producto", rr: 1, precision: 0.5, zero: false, ms: 100, ...p,
  };
}

function reporte(evs: EvaluacionBusqueda[], c: { hash?: string; medidas?: string; sha?: string } = {}): ReporteJson {
  const resumen = resumenNumerico(evs, false);
  const cabecera: Cabecera = {
    fecha: "2026-01-02T03:04:05.000Z", gitSha: c.sha ?? "abc1234", sucio: false, tuberia: "v2",
    jev: { modo: "no", modelo: null, grabadoEl: null },
    banco: { origen: "versionado", n: evs.length, hash: c.hash ?? "aaaaaaaaaaaa" },
    vista: { variante: "banco", soloVisibles: false, soloStock: false },
    flags: {},
    snapshot: { universo: { no_disponible: "x" }, categorias: 3, arbolHash: "b".repeat(32), estructurados: true },
    repeticiones: 1, calentar: 0, tenantAlias: "shop", duracionMs: 10,
    ...(c.medidas ? { busquedaMedidas: c.medidas } : {}),
  };
  return { esquema: 1, cabecera, resumen, cortes: { perfil: cortarPor(evs, "perfil", false), intencion: {}, tipo: cortarPor(evs, "tipo", false) }, latencia: resumen.latencia, excluidos: { sinGrabacion: 0 }, casos: [] };
}

const matriz = (corridas: Record<string, ReporteJson>): MatrizJson => ({
  esquema: 1,
  generadoEl: "2026-01-02",
  corridas: Object.entries(corridas).map(([id, r]) => ({ id, banco: "sintetico", vista: "banco", tuberia: "v2", jev: "no", reporte: r })),
});

const antes = matriz({
  "sintetico-banco-v2-sinjev": reporte([
    ev(0, { tipo: "medida", top24Ok: false, posicion: null, rr: 0, zero: true, total: 0, ms: 100, medida: medida({ precision: 0.5, contradicciones: 4, inversiones: 3, cobertura: 0.4 }) }),
    ev(1, { tipo: "medida", ms: 120, medida: medida({ precision: 0.7, contradicciones: 2, inversiones: 2, cobertura: 0.4 }) }),
    ev(2, { tipo: "producto", ms: 90 }),
    ev(3, { tipo: "producto", ms: 90 }),
  ], { medidas: "off" }),
});
const despues = matriz({
  "sintetico-banco-v2-sinjev": reporte([
    ev(0, { tipo: "medida", ms: 100, medida: medida({ precision: 0.9, contradicciones: 0, cobertura: 0.4, hit: true }) }),
    ev(1, { tipo: "medida", ms: 130, medida: medida({ precision: 1, contradicciones: 0, cobertura: 0.4, hit: true }) }),
    ev(2, { tipo: "producto", ms: 90 }),
    ev(3, { tipo: "producto", ms: 90 }),
  ], { medidas: "on", sha: "def5678" }),
});

describe("compararMatrices", () => {
  const texto = compararMatrices(antes, despues);

  it("imprime las dos cabeceras con el estado de busqueda-medidas", () => {
    expect(texto).toContain("busqueda-medidas: off");
    expect(texto).toContain("busqueda-medidas: on");
    expect(texto).toContain("abc1234");
    expect(texto).toContain("def5678");
  });

  it("delta de hit@24, medida-precision@24, contradicciones@24, zero-result y p95 por tipo", () => {
    expect(texto).toContain("sintetico-banco-v2-sinjev");
    expect(texto).toMatch(/medida\s+\|/);
    expect(texto).toMatch(/producto\s+\|/);
    expect(texto).toMatch(/total\s+\|/);
    // tipo medida: hit@24 50 % -> 100 %
    expect(texto).toContain("50.0% → 100.0% (+50.0 pp)");
    // precisión 60 % -> 95 %
    expect(texto).toContain("60.0% → 95.0% (+35.0 pp)");
    // contradicciones 6 -> 0
    expect(texto).toContain("6 → 0 (-6)");
    // zero-result 1/2 -> 0/2
    expect(texto).toContain("50.0% → 0.0% (-50.0 pp)");
    // p95 120 -> 130 ms
    expect(texto).toContain("120 → 130 ms (+10)");
  });

  it("delta de inversiones@24 (orden): 5 -> 0", () => {
    expect(texto).toContain("5 → 0 (-5)");
  });

  it("un snapshot anterior a la métrica de orden (sin inversiones) queda n/a, no 0", () => {
    const rViejo = reporte([ev(0, { tipo: "medida", medida: medida({ precision: 0.5, contradicciones: 4 }) })], { medidas: "off" });
    // Un snapshot viejo no trae el campo (ni en el total ni en el corte): se lo saca para reproducirlo.
    for (const r of [rViejo.resumen, rViejo.cortes.tipo.medida]) delete (r.medida as { inversiones?: number }).inversiones;
    const viejo = matriz({ "sintetico-banco-v2-sinjev": rViejo });
    const nuevo = matriz({ "sintetico-banco-v2-sinjev": reporte([ev(0, { tipo: "medida", medida: medida({ precision: 0.5, contradicciones: 4, inversiones: 2 }) })], { medidas: "on" }) });
    const fila = compararMatrices(viejo, nuevo).split("\n").find((l) => /^medida\s+\|/.test(l))!;
    expect(fila.split(" | ")[4]).toBe("n/a");
  });

  it("encabezado de columnas con los nombres de las métricas", () => {
    for (const nombre of ["hit@24", "medida-precision@24", "contradicciones@24", "inversiones@24", "zero-result", "p95"]) expect(texto).toContain(nombre);
  });

  it("un tipo sin medidas en alguno de los lados queda n/a, no 0", () => {
    expect(texto).toMatch(/producto\s+\|[^\n]*n\/a/);
  });

  it("avisa si el banco es distinto (hash) pero compara igual", () => {
    const otro = matriz({ "sintetico-banco-v2-sinjev": reporte([ev(0)], { hash: "bbbbbbbbbbbb" }) });
    const t = compararMatrices(antes, otro);
    expect(t).toMatch(/ADVERTENCIA[^\n]*banco/i);
    expect(t).toContain("hit@24");
  });

  it("corridas que están sólo de un lado se listan aparte", () => {
    const extra = matriz({ "sintetico-banco-v2-sinjev": despues.corridas[0].reporte, "sintetico-banco-clasica": despues.corridas[0].reporte });
    const t = compararMatrices(antes, extra);
    expect(t).toContain("sólo en la corrida actual: sintetico-banco-clasica");
  });

  it("snapshot viejo sin el campo busquedaMedidas: lo dice en vez de romper", () => {
    const viejo = matriz({ "sintetico-banco-v2-sinjev": reporte([ev(0)]) });
    expect(compararMatrices(viejo, despues)).toContain("busqueda-medidas: sin dato");
  });

  it("sólo agregados: no imprime consultas", () => {
    const conQ = matriz({ "sintetico-banco-v2-sinjev": reporte([ev(0, { q: "consulta-secreta" })]) });
    expect(compararMatrices(conQ, conQ)).not.toContain("consulta-secreta");
  });
});

describe("parsearSnapshot / leerSnapshot", () => {
  it("acepta una matriz válida", () => {
    expect(parsearSnapshot(JSON.parse(JSON.stringify(antes))).corridas).toHaveLength(1);
  });

  it("rechaza formas inválidas sin citar el contenido", () => {
    for (const malo of [null, [], {}, { corridas: "x" }, { corridas: [{ id: "a" }] }, { corridas: [{ id: "a", reporte: {} }] }]) {
      expect(() => parsearSnapshot(malo)).toThrow(/snapshot/i);
    }
  });

  it("lee de un archivo o de la carpeta con matriz.json; errores claros sin volcar el archivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "banco-comparar-"));
    try {
      writeFileSync(join(dir, "matriz.json"), JSON.stringify(antes));
      expect(leerSnapshot(dir).corridas).toHaveLength(1);
      expect(leerSnapshot(join(dir, "matriz.json")).corridas).toHaveLength(1);
      expect(() => leerSnapshot(join(dir, "no-existe.json"))).toThrow(/No existe/);
      writeFileSync(join(dir, "roto.json"), "{ contenido-secreto");
      try {
        leerSnapshot(join(dir, "roto.json"));
        throw new Error("debía fallar");
      } catch (e) {
        expect((e as Error).message).toMatch(/JSON válido/);
        expect((e as Error).message).not.toContain("contenido-secreto");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
