import { describe, expect, it } from "vitest";
import fixture from "../../../db/__fixtures__/medidas-dorados.json";
import claves from "../../../db/__fixtures__/atributos-claves.json";
import { CONTEXTOS, CURVAS, RANGOS, ZOCALOS } from "./medidas";
import { CLAVES_ENTERAS, CLAVES_MEDIDA, DIMENSION_MM, SERIE_IEC } from "../../catalogo-atributos-medida";

/**
 * R3.2: el fixture es el contrato compartido con el admin. Si cambia el vocabulario del parser sin
 * cambiar el fixture (o al revés), este test rompe; el test de paridad del admin lo cruza con el extractor.
 */
const voc = fixture.vocabulario;

describe("vocabulario del parser == vocabulario del fixture", () => {
  it("las claves del fixture son un subconjunto de las claves de catalog_atributos", () => {
    for (const c of voc.claves) expect(claves.claves, c).toContain(c);
    expect(new Set(voc.claves).size).toBe(voc.claves.length);
  });

  it("claves, zócalos, curvas, rangos, enteros, dimensiones y serie IEC", () => {
    expect([...CLAVES_MEDIDA]).toEqual(voc.claves);
    expect([...ZOCALOS]).toEqual(voc.zocalos);
    expect([...CURVAS]).toEqual(voc.curvas);
    expect(Object.fromEntries(Object.entries(RANGOS))).toEqual(voc.rangos);
    expect([...CLAVES_ENTERAS]).toEqual(voc.enteros);
    expect([...DIMENSION_MM]).toEqual(voc.dimension_mm);
    expect([...SERIE_IEC]).toEqual(voc.serie_iec);
  });

  it("contexto de protección, cable, panel y luminaria", () => {
    expect(CONTEXTOS).toEqual(voc.contexto);
  });

  it("todos los rangos son de claves del vocabulario y están ordenados", () => {
    for (const [c, [min, max]] of Object.entries(voc.rangos)) {
      expect(voc.claves, c).toContain(c);
      expect(min).toBeLessThan(max);
    }
  });

  it("cada caso trae id único, consulta y esperado con claves del vocabulario", () => {
    expect(new Set(fixture.casos.map((c) => c.id)).size).toBe(fixture.casos.length);
    for (const caso of fixture.casos) {
      for (const m of caso.esperado) expect(voc.claves, caso.id).toContain(m.clave);
    }
  });

  it("repo público: el fixture no trae marcas, URLs ni dominios reales", () => {
    const texto = JSON.stringify(fixture);
    expect(texto).not.toMatch(/https?:|www\.|@|\.com|\.ar\b/i);
  });
});
