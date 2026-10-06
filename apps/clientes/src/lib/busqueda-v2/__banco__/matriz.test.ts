import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Cabecera, ReporteJson } from "./corrida";
import { formatearMatriz, parsearArgsLinea, planDeMatriz, type CorridaDeMatriz } from "./matriz";
import { cortarPor, resumenNumerico } from "./metricas";

describe("planDeMatriz", () => {
  const clave = (e: { banco: string; vista: string; tuberia: string; jev: string }) => `${e.banco}/${e.vista}/${e.tuberia}/${e.jev}`;

  it("sintético: clasica, tolerante, fase1 sin Jev, v2 sin Jev y v2 con Jev grabado, en las dos vistas", () => {
    const p = planDeMatriz({ bancoReal: false, jevVivo: false });
    expect(p).toHaveLength(10);
    for (const vista of ["banco", "produccion"]) {
      expect(p.filter((e) => e.vista === vista).map(clave)).toEqual([
        `sintetico/${vista}/clasica/no aplica`,
        `sintetico/${vista}/tolerante/no aplica`,
        `sintetico/${vista}/fase1/no`,
        `sintetico/${vista}/v2/no`,
        `sintetico/${vista}/v2/grabado`,
      ]);
    }
  });

  it("real: la misma matriz pero con v2 sobre el plan cacheado en vez del Jev grabado (que no cubre consultas reales)", () => {
    const p = planDeMatriz({ bancoReal: true, jevVivo: false }).filter((e) => e.banco === "real");
    expect(p).toHaveLength(10);
    expect(p.map((e) => `${e.tuberia}/${e.jev}`).slice(0, 5)).toEqual(["clasica/no aplica", "tolerante/no aplica", "fase1/no", "v2/no", "v2/cache"]);
    expect(p.some((e) => e.jev === "grabado")).toBe(false);
  });

  it("sin banco real, no hay entradas reales", () => {
    expect(planDeMatriz({ bancoReal: false, jevVivo: false }).some((e) => e.banco === "real")).toBe(false);
    expect(planDeMatriz({ bancoReal: true, jevVivo: false })).toHaveLength(20);
  });

  it("v2 vivo sólo con el flag explícito y sólo sobre el banco sintético", () => {
    expect(planDeMatriz({ bancoReal: true, jevVivo: false }).some((e) => e.jev === "vivo")).toBe(false);
    const conVivo = planDeMatriz({ bancoReal: true, jevVivo: true }).filter((e) => e.jev === "vivo");
    expect(conVivo.map(clave)).toEqual(["sintetico/banco/v2/vivo", "sintetico/produccion/v2/vivo"]);
  });

  it("fase1 nunca usa Jev en la matriz (la corrida congelada no gasta)", () => {
    for (const e of planDeMatriz({ bancoReal: true, jevVivo: true }).filter((x) => x.tuberia === "fase1")) expect(e.jev).toBe("no");
  });

  it("ids únicos y sin texto de consultas", () => {
    const ids = planDeMatriz({ bancoReal: true, jevVivo: true }).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("planDeMatriz con --motor", () => {
  const motor = (extra = {}) => planDeMatriz({ bancoReal: false, jevVivo: false, motor: true, ...extra }).filter((e) => e.tuberia === "motor");

  it("sin --motor la matriz es la de siempre (mismos ids, mismo largo)", () => {
    const sin = planDeMatriz({ bancoReal: true, jevVivo: true });
    const con = planDeMatriz({ bancoReal: true, jevVivo: true, motor: true });
    expect(con.filter((e) => e.tuberia !== "motor")).toEqual(sin);
  });

  it("agrega por banco/vista las filas del motor, legado y cascada: catálogo en ambas vistas; autocompletar y chat sólo en producción", () => {
    expect(motor().map((e) => e.id)).toEqual([
      "sintetico-banco-motor-legado-catalogo",
      "sintetico-banco-motor-cascada-catalogo",
      "sintetico-produccion-motor-legado-catalogo",
      "sintetico-produccion-motor-legado-autocompletar",
      "sintetico-produccion-motor-legado-chat",
      "sintetico-produccion-motor-cascada-catalogo",
      "sintetico-produccion-motor-cascada-autocompletar",
      "sintetico-produccion-motor-cascada-chat",
    ]);
  });

  it("el banco real mide el motor con el plan cacheado; el sintético, con el Jev grabado", () => {
    expect(new Set(motor().map((e) => e.jev))).toEqual(new Set(["grabado"]));
    const real = planDeMatriz({ bancoReal: true, jevVivo: false, motor: true }).filter((e) => e.tuberia === "motor" && e.banco === "real");
    expect(real).toHaveLength(8);
    expect(new Set(real.map((e) => e.jev))).toEqual(new Set(["cache"]));
  });

  it("cada fila declara su política y su superficie, y los ids no se repiten", () => {
    const todas = planDeMatriz({ bancoReal: true, jevVivo: true, motor: true });
    for (const e of todas.filter((x) => x.tuberia === "motor")) {
      expect(["legado", "cascada"]).toContain(e.politica);
      expect(["catalogo", "autocompletar", "chat"]).toContain(e.superficie);
      expect(e.id).toContain(`motor-${e.politica}-${e.superficie}`);
    }
    expect(new Set(todas.map((e) => e.id)).size).toBe(todas.length);
  });
});

describe("parsearArgsLinea", () => {
  it("exige --solo-visibles=si|no (el valor del flag en producción)", () => {
    expect(() => parsearArgsLinea([])).toThrow(/--solo-visibles=si\|no/);
    expect(parsearArgsLinea(["--solo-visibles=si"]).soloVisibles).toBe(true);
    expect(parsearArgsLinea(["--solo-visibles=no"]).soloVisibles).toBe(false);
    expect(() => parsearArgsLinea(["--solo-visibles=tal"])).toThrow(/si\|no/);
  });

  it("defaults: 3 repeticiones, 3 de calentamiento, Jev vivo apagado, sin banco real", () => {
    const a = parsearArgsLinea(["--solo-visibles=no"]);
    expect(a).toMatchObject({ repeticiones: 3, calentar: 3, jevVivo: false, tenantAlias: "shop", etiquetas: "revisado" });
    expect(a.bancoReal).toBeUndefined();
    expect(a.dir).toBeUndefined();
  });

  it("flags, banco real, directorio y --jev=vivo", () => {
    const a = parsearArgsLinea([
      "--solo-visibles=si",
      "--flags=busqueda-ia:on,catalogo-solo-visibles:on",
      "--banco-real=tmp/busqueda/banco-real.local.json",
      "--repeticiones=2",
      "--dir=tmp/busqueda/linea-base-x",
      "--jev=vivo",
    ]);
    expect(a).toMatchObject({
      flags: { "busqueda-ia": "on", "catalogo-solo-visibles": "on" },
      bancoReal: "tmp/busqueda/banco-real.local.json",
      repeticiones: 2,
      dir: "tmp/busqueda/linea-base-x",
      jevVivo: true,
    });
  });

  it("--motor agrega las filas del motor (apagado por defecto)", () => {
    expect(parsearArgsLinea(["--solo-visibles=si"]).motor).toBe(false);
    expect(parsearArgsLinea(["--solo-visibles=si", "--motor"]).motor).toBe(true);
  });

  it("--comparar=<snapshot> se acepta y por defecto no hay comparación", () => {
    expect(parsearArgsLinea(["--solo-visibles=si", "--comparar=tmp/busqueda/linea-base-x"]).comparar).toBe("tmp/busqueda/linea-base-x");
    expect(parsearArgsLinea(["--solo-visibles=si"]).comparar).toBeUndefined();
  });

  it("otros --jev y flags desconocidos fallan", () => {
    expect(() => parsearArgsLinea(["--solo-visibles=si", "--jev=no"])).toThrow(/--jev/);
    expect(() => parsearArgsLinea(["--solo-visibles=si", "--bancoreal=x"])).toThrow(/desconocido/i);
  });
});

/** Un ReporteJson mínimo para formatear la matriz. */
function reporte(p: { hash?: string; arbolHash?: string; hit24?: number; mrr?: number; zero?: number } = {}): ReporteJson {
  const evs = Array.from({ length: 4 }, (_, i) => ({
    q: `#${i}`, diagnostico: false, intencionOk: null, categoriaOk: null, atributosOk: null, top24Ok: i < 2, posicion: i < 2 ? 1 : null, sinResultadosIndebido: false,
    puntos: 0, posibles: 0, total: 5, perfil: "desconocido", tipo: "producto" as const, rr: i < 2 ? 1 : 0, precision: 0.5, zero: false, ms: 10 + i,
  }));
  const resumen = resumenNumerico(evs, false);
  if (p.hit24 !== undefined) resumen.hit24 = p.hit24;
  if (p.mrr !== undefined) resumen.mrr = p.mrr;
  if (p.zero !== undefined) resumen.zeroRate = p.zero;
  const cabecera: Cabecera = {
    fecha: "2026-01-02T03:04:05.000Z", gitSha: "abc1234", sucio: false, tuberia: "v2",
    jev: { modo: "no", modelo: null, grabadoEl: null },
    banco: { origen: "banco-real.local.json", n: 4, hash: p.hash ?? "aaaaaaaaaaaa" },
    vista: { variante: "banco", soloVisibles: false, soloStock: false },
    flags: { "busqueda-ia": "on" },
    snapshot: { universo: { activos: 10, publicados: 7, conStock: 5, publicadosConStock: 4, sinOverlay: 3, sinCategoria: 1 }, categorias: 3, arbolHash: p.arbolHash ?? "b".repeat(32), estructurados: true },
    repeticiones: 3, calentar: 3, tenantAlias: "shop", duracionMs: 1234,
  };
  return { esquema: 1, cabecera, resumen, cortes: { perfil: cortarPor(evs, "perfil", false), intencion: {}, tipo: cortarPor(evs, "tipo", false) }, latencia: resumen.latencia, excluidos: { sinGrabacion: 0 }, casos: [] };
}

const corrida = (id: string, banco: "sintetico" | "real", vista: "banco" | "produccion", tuberia: CorridaDeMatriz["tuberia"], jev: CorridaDeMatriz["jev"], r = reporte()): CorridaDeMatriz => ({ id, banco, vista, tuberia, jev, reporte: r });

describe("formatearMatriz", () => {
  const corridas = [
    corrida("a", "real", "banco", "clasica", "no aplica"),
    corrida("b", "real", "banco", "v2", "no", reporte({ hit24: 0.5, mrr: 0.4, zero: 0.2 })),
    corrida("c", "real", "banco", "v2", "cache", reporte({ hit24: 0.7, mrr: 0.5, zero: 0.1 })),
  ];
  const texto = formatearMatriz(corridas);

  it("tabla motor x métricas, agregada, con la cabecera común", () => {
    for (const col of ["hit@24", "MRR", "precision@24", "zero", "p50", "p95"]) expect(texto).toContain(col);
    expect(texto).toContain("clasica");
    expect(texto).toContain("v2 (cache)");
    expect(texto).toContain("abc1234");
    expect(texto).toContain("banco-real.local.json");
  });

  it("delta con/sin Jev (v2 con Jev menos v2 sin Jev)", () => {
    expect(texto).toMatch(/delta/i);
    expect(texto).toMatch(/hit@24[^\n]*\+20\.0/);
  });

  it("sólo agregados: no hay texto de consultas (los casos no se vuelcan)", () => {
    expect(texto).not.toMatch(/«|consulta →/);
  });

  it("advierte si dos corridas de un mismo banco no son comparables (distinto hash o snapshot)", () => {
    const malas = [corrida("a", "real", "banco", "clasica", "no aplica"), corrida("b", "real", "banco", "v2", "no", reporte({ hash: "cccccccccccc" }))];
    expect(formatearMatriz(malas)).toMatch(/no son comparables/i);
    const snap = [corrida("a", "real", "banco", "clasica", "no aplica"), corrida("b", "real", "banco", "v2", "no", reporte({ arbolHash: "d".repeat(32) }))];
    expect(formatearMatriz(snap)).toMatch(/no son comparables/i);
    expect(texto).not.toMatch(/no son comparables/i);
  });
});

describe("formatearMatriz con filas del motor", () => {
  const motorRep = (superficie: "catalogo" | "autocompletar" | "chat", k: number, etapas: Record<string, number>, politica: "legado" | "cascada" = "legado") => {
    const r = reporte();
    r.cabecera = { ...r.cabecera, tuberia: "motor", politica, superficie: { nombre: superficie, k, conteo: superficie === "catalogo" }, vista: { variante: "produccion", soloVisibles: true, soloStock: true } };
    r.etapas = etapas;
    return r;
  };
  const corridas = [
    corrida("a", "sintetico", "produccion", "v2", "no"),
    corrida("b", "sintetico", "produccion", "motor", "grabado", motorRep("catalogo", 24, { plan: 3, exacta: 1 })),
    corrida("c", "sintetico", "produccion", "motor", "grabado", motorRep("chat", 10, { exacta: 3, tolerante: 1 })),
  ].map((c, i) => (i === 0 ? c : { ...c, politica: "legado" as const, superficie: i === 1 ? ("catalogo" as const) : ("chat" as const) }));
  const texto = formatearMatriz(corridas);

  it("etiqueta cada fila del motor con política, superficie y K", () => {
    expect(texto).toContain("motor legado/catalogo K=24");
    expect(texto).toContain("motor legado/chat K=10");
  });

  it("suma el histograma de etapas (sólo agregados)", () => {
    expect(texto).toMatch(/etapas motor legado\/catalogo: plan 3, exacta 1/);
    expect(texto).toMatch(/etapas motor legado\/chat: exacta 3, tolerante 1/);
  });

  it("no advierte falta de comparabilidad entre filas de otra superficie o política (difieren a propósito)", () => {
    expect(texto).not.toMatch(/no son comparables/i);
  });

  it("declara el estado de las medidas (flag busqueda-medidas) en la cabecera", () => {
    expect(texto).toMatch(/medidas: no declarado/);
    const r = motorRep("catalogo", 24, { exacta: 1 });
    r.cabecera.flags = { "busqueda-medidas": "on" };
    expect(formatearMatriz([{ ...corrida("b", "sintetico", "produccion", "motor", "grabado", r), politica: "legado", superficie: "catalogo" }])).toMatch(/medidas: on/);
  });
});

describe("formatearMatriz: criterios de la cascada", () => {
  const motorRep = (superficie: "catalogo" | "chat", k: number, politica: "legado" | "cascada") => {
    const r = reporte();
    r.cabecera = { ...r.cabecera, tuberia: "motor", politica, superficie: { nombre: superficie, k, conteo: superficie === "catalogo" }, vista: { variante: "produccion", soloVisibles: true, soloStock: true } };
    return r;
  };
  const fila = (id: string, politica: "legado" | "cascada", superficie: "catalogo" | "chat", k: number) => ({
    ...corrida(id, "sintetico", "produccion", "motor", "grabado", motorRep(superficie, k, politica)),
    politica,
    superficie,
  });

  it("con filas legado y cascada de la misma superficie agrega la sección de criterios (sólo agregados)", () => {
    const texto = formatearMatriz([fila("l", "legado", "catalogo", 24), fila("c", "cascada", "catalogo", 24)]);
    expect(texto).toMatch(/Criterios de aceptación de la cascada/);
    expect(texto).toMatch(/superficie catalogo/);
    expect(texto).toMatch(/mejora de typos/i);
    expect(texto).not.toMatch(/«/);
  });

  it("una cascada sin su fila legado avisa que no hay con qué comparar", () => {
    expect(formatearMatriz([fila("c", "cascada", "chat", 10)])).toMatch(/no hay con qué comparar/);
  });

  it("sin filas cascada la matriz no cambia", () => {
    expect(formatearMatriz([fila("l", "legado", "catalogo", 24)])).not.toMatch(/Criterios de aceptación/);
  });
});

describe("scripts de npm", () => {
  it("banco:linea-base está registrado en apps/clientes y no hay package.json en la raíz", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8"));
    expect(pkg.scripts["banco:linea-base"]).toMatch(/tsx --env-file-if-exists=\.env\.local .*__banco__\/linea-base\.ts$/);
    expect(pkg.scripts["banco:busqueda"]).toBeDefined();
    expect(existsSync(fileURLToPath(new URL("../../../../../../package.json", import.meta.url)))).toBe(false);
  });
});
