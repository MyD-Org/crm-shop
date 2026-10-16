import { describe, it, expect } from "vitest";
import { leerAtributosExtras, filasExtras, leerAtributosEstructurados } from "./catalogo-caracteristicas";

const crudo = { potencia_w: { n: "20", t: null }, haz_grados: { n: 36, t: null }, acabado: { n: null, t: "mate" }, basura: { n: null, t: "" } };
const fields = { haz_grados: { etiqueta: "Haz", unidad: "°", orden: 30 }, acabado: { etiqueta: "Acabado", unidad: null, orden: 31 } };

describe("claves nuevas desde la spec", () => {
  it("leerAtributosExtras separa lo que el Shop no conoce; lo conocido sigue en leerAtributosEstructurados", () => {
    expect(leerAtributosExtras(crudo)).toEqual({ haz_grados: { n: 36, t: null }, acabado: { n: null, t: "mate" } });
    expect(leerAtributosEstructurados(crudo)).toEqual({ potencia_w: { n: 20, t: null } });
  });
  it("filasExtras dibuja sólo lo declarado en fields, con etiqueta y unidad, en orden", () => {
    expect(filasExtras({ acabado: { n: null, t: "mate" }, haz_grados: { n: 36.5, t: null }, otra: { n: 1, t: null } }, fields)).toEqual([
      { etiqueta: "Haz", valor: "36,5 °" },
      { etiqueta: "Acabado", valor: "mate" },
    ]);
    expect(filasExtras({ haz_grados: { n: 36, t: null } }, null)).toEqual([]);
  });
});
