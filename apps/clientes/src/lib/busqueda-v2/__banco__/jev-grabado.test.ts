import { describe, expect, it } from "vitest";
import { faltantes, mezclar, type JevGrabado } from "./jev-grabado";

const grabado = (claves: string[]): JevGrabado => ({
  modelo: "jev-x",
  grabadoEl: "2026-01-01",
  respuestas: Object.fromEntries(claves.map((k) => [k, { principal: { intencion: { choice: "producto", confidence: 0.9 } } as never }])),
});

describe("faltantes", () => {
  it("devuelve sólo las consultas normalizadas sin respuesta grabada", () => {
    const g = grabado(["lampara generica"]);
    const r = faltantes([{ q: "Lámpara genérica" }, { q: "cable generico" }, { q: "termica 2x20" }], g);
    // "Lámpara genérica" se normaliza (sin tildes) a "lampara generica": ya está grabada.
    expect(r).toEqual(["cable generico", "termica 2x20"]);
  });

  it("no repite las existentes ni las duplicadas del banco", () => {
    const g = grabado(["uno"]);
    expect(faltantes([{ q: "uno" }, { q: "dos" }, { q: "Dos" }, { q: "dos " }], g)).toEqual(["dos"]);
  });

  it("los códigos y lo que no se normaliza (datos personales) no se preguntan", () => {
    const g = grabado([]);
    expect(faltantes([{ q: "DL-18W" }, { q: "contacto a@b.example" }, { q: "lampara generica" }], g)).toEqual(["lampara generica"]);
  });

  it("sin faltantes devuelve una lista vacía", () => {
    expect(faltantes([{ q: "uno" }], grabado(["uno"]))).toEqual([]);
  });
});

describe("mezclar", () => {
  const nueva = { principal: { intencion: { choice: "necesidad", confidence: 0.8 } } as never };

  it("agrega las nuevas sin tocar las existentes (ni pisarlas si coinciden)", () => {
    const g = grabado(["uno"]);
    const antes = JSON.stringify(g.respuestas.uno);
    const m = mezclar(g, { uno: nueva, dos: nueva }, "2026-02-02");
    expect(JSON.stringify(m.respuestas.uno)).toBe(antes);
    expect(Object.keys(m.respuestas)).toEqual(["uno", "dos"]);
    expect(m.respuestas.dos).toBe(nueva);
  });

  it("conserva modelo y fecha de grabado; registra cuándo se amplió", () => {
    const m = mezclar(grabado([]), { dos: nueva }, "2026-02-02");
    expect(m).toMatchObject({ modelo: "jev-x", grabadoEl: "2026-01-01", ampliadoEl: "2026-02-02" });
  });

  it("no muta el grabado original", () => {
    const g = grabado(["uno"]);
    mezclar(g, { dos: nueva }, "2026-02-02");
    expect(Object.keys(g.respuestas)).toEqual(["uno"]);
    expect((g as { ampliadoEl?: string }).ampliadoEl).toBeUndefined();
  });
});
