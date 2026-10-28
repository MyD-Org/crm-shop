import { describe, expect, it } from "vitest";
import { contextoDe, idsActivasEn, type CampaniaShop } from "./vigentes";

// Bordes de la vigencia (foco 1 del plan): inicio inclusivo, fin exclusivo. Datos inventados.

const BF: CampaniaShop = {
  id: "c-bf",
  nombre: "Black Friday",
  etiqueta: "BF",
  inicio: "2026-11-27T03:00:00.000Z",
  fin: "2026-12-01T03:00:00.000Z",
};
const CYBER: CampaniaShop = {
  id: "c-cyber",
  nombre: "Cyber Monday",
  etiqueta: "Cyber",
  inicio: "2026-12-01T03:00:00.000Z",
  fin: "2026-12-03T03:00:00.000Z",
};

const en = (iso: string) => idsActivasEn([CYBER, BF], new Date(iso)).map((c) => c.id);

describe("idsActivasEn", () => {
  it("en el inicio ya está activa", () => {
    expect(en(BF.inicio)).toEqual(["c-bf"]);
  });

  it("un milisegundo antes del fin sigue activa", () => {
    expect(en("2026-12-01T02:59:59.999Z")).toEqual(["c-bf"]);
  });

  it("en el fin ya no: empieza la contigua", () => {
    expect(en(BF.fin)).toEqual(["c-cyber"]);
  });

  it("terminada dentro de la gracia de 24 h: viene en la lista pero no está activa", () => {
    expect(en("2026-12-03T10:00:00.000Z")).toEqual([]);
  });

  it("devuelve la meta para exhibir, ordenada por id (va en la clave de la caché)", () => {
    const solapadas = [{ ...CYBER, inicio: BF.inicio }, BF];
    expect(idsActivasEn(solapadas, new Date("2026-11-28T00:00:00Z"))).toEqual([
      { id: "c-bf", nombre: "Black Friday", etiqueta: "BF", fin: BF.fin },
      { id: "c-cyber", nombre: "Cyber Monday", etiqueta: "Cyber", fin: CYBER.fin },
    ]);
  });
});

describe("contextoDe", () => {
  it("convierte las activas en el set que usa resolverPrecioVigente", () => {
    const ctx = contextoDe(idsActivasEn([BF], new Date("2026-11-28T00:00:00Z")));
    expect([...ctx.activas]).toEqual(["c-bf"]);
  });
});
