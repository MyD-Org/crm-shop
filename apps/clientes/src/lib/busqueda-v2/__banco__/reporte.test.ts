import { describe, expect, it } from "vitest";
import { evaluar, reporte, reporteAmpliado, type BusquedaBanco, type ResultadoBanco } from "./banco";

/** Fixture sintético: tres casos genéricos. */
const arbol = [{ id: "c1", parentId: null, nombre: "Lamparas" }];
const casos: BusquedaBanco[] = [
  { q: "foco calido", perfil: "particular", diagnostico: true, intencion: "producto", categoria: ["Lamparas"], debeIncluirEnTop24: ["lampara"], nuncaSinResultados: true },
  { q: "cable raro", perfil: "profesional", intencion: "producto", debeIncluirEnTop24: ["cable"], nuncaSinResultados: true },
  { q: "XQ-1", perfil: "codigo", intencion: "codigo", sinDuros: true },
];
const vacio = { categoriasDuras: [], categoriasBlandas: [], atributosDuros: [], expansiones: [] };
const resultados: ResultadoBanco[] = [
  { ...vacio, intencion: "producto", categoriasDuras: ["Lamparas"], productos: [{ name: "x" }, { name: "lampara e27", categoriaPropiaId: "c1" }], total: 2, ms: 10 },
  { ...vacio, intencion: "necesidad", productos: [], total: 0 },
  { ...vacio, intencion: "codigo", productos: [{ name: "y" }], total: 1 },
];
const evs = casos.map((b, i) => evaluar(b, resultados[i], arbol));

// Texto de `reporte()` ANTES de la línea base (capturado con el código previo): la tabla y el
// resumen existentes no pueden cambiar (spec A1).
const BASE_V2 =
  "# Banco de búsquedas — tubería v2\n\nint cat atr top pos  total  consulta → categoría entendida\n ✓   ✓   ·   ✓    2      2  *foco calido → Lamparas\n ✗   ·   ·   ✗    -      0   cable raro → -  [SIN RESULTADOS]\n ✓   ✓   ·   ·    -      1   XQ-1 → -\n\n(* = diagnóstico 2026-09-30)\n\nconjunto     | n | intención | categoría | atributos | top 24 | top 3 | pos. media | sin resultados indebidos | puntaje %\ntotal        | 3 | 2/3 (67%) | 2/2 (100%) | n/a | 1/2 (50%) | 1/2 (50%) | 2.0 | 1 | 61.5\ndiagnóstico  | 1 | 1/1 (100%) | 1/1 (100%) | n/a | 1/1 (100%) | 1/1 (100%) | 2.0 | 0 | 100";
const BASE_PREVIA =
  "# Banco de búsquedas — tubería v2\n\nint cat atr top pos  total  consulta → categoría entendida\n ·   ✓   ·   ✓    2      2  *foco calido → Lamparas\n ·   ·   ·   ✗    -      0   cable raro → -  [SIN RESULTADOS]\n ·   ✓   ·   ·    -      1   XQ-1 → -\n\n(* = diagnóstico 2026-09-30)\n\nconjunto     | n | intención | categoría | atributos | top 24 | top 3 | pos. media | sin resultados indebidos | puntaje %\ntotal        | 3 | n/a (0/0) | 2/2 (100%) | n/a | 1/2 (50%) | 1/2 (50%) | 2.0 | 1 | 61.5\ndiagnóstico  | 1 | n/a (0/0) | 1/1 (100%) | n/a | 1/1 (100%) | 1/1 (100%) | 2.0 | 0 | 100";

describe("reporte (tabla y resumen de siempre)", () => {
  it("es idéntico al texto previo a la línea base (v2)", () => {
    expect(reporte("Banco de búsquedas — tubería v2", evs, true)).toBe(BASE_V2);
  });

  it("es idéntico al texto previo a la línea base (sin intención)", () => {
    expect(reporte("Banco de búsquedas — tubería v2", evs, false)).toBe(BASE_PREVIA);
  });
});

describe("reporteAmpliado (bloque adicional)", () => {
  const texto = reporteAmpliado(evs, true);

  it("trae las métricas nuevas en total", () => {
    expect(texto).toContain("## Métricas ampliadas");
    for (const col of ["hit@24", "hit@3", "MRR", "precision@24", "zero total", "zero indebido", "p50 ms", "p95 ms"]) {
      expect(texto).toContain(col);
    }
    expect(texto).toMatch(/^total\s+\| 3 \| 50\.0% \| 50\.0% \| 0\.250 /m);
  });

  it("corta por perfil, intención esperada y tipo", () => {
    expect(texto).toContain("### por perfil");
    expect(texto).toMatch(/^profesional\s+\| 1 /m);
    expect(texto).toContain("### por intención esperada");
    expect(texto).toContain("### por tipo de consulta");
    expect(texto).toMatch(/^codigo\s+\| 1 /m);
  });

  it("sólo agregados: no imprime las consultas", () => {
    expect(texto).not.toContain("foco calido");
    expect(texto).not.toContain("cable raro");
  });

  it("sin casos no genera NaN", () => {
    expect(reporteAmpliado([], true)).not.toMatch(/NaN|undefined/);
  });
});
