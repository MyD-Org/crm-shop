import { describe, expect, it } from "vitest";
import { REGISTRO } from "@/test/registro-usted";
import { CANTIDAD_PREGUNTAS, PREGUNTAS, preguntasSugeridas } from "./preguntas-producto";

const productos = [
  { name: "REFLECTOR LED 50W CALIDO IP65", category: "REFLECTORES" },
  { name: "TIRA 5050 BCO FRIO IP20 12V", category: "TIRAS LED" },
  { name: "LAMPARA LED 9W E27 FRIA", category: "LAMPARAS" },
  { name: "DICROICA LED 7W GU10", category: "LAMPARAS" },
  { name: "FUENTE 12V 5A", category: "FUENTES" },
  { name: "CABLE TALLER 2X1.5", category: "CABLES" },
  { name: "LLAVE 1 PUNTO 10A", category: "MATERIAL ELECTRICO" },
  { name: "PRODUCTO SIN PISTAS" },
  { name: "PANEL LED 18W", description: "Apto para exteriores, luz neutra 4000K", category: "PANELES" },
];

describe("preguntas sugeridas de la ficha", () => {
  it("siempre tres, sin repetir, con la de complementos al final", () => {
    for (const p of productos) {
      const preguntas = preguntasSugeridas(p);
      expect(preguntas).toHaveLength(CANTIDAD_PREGUNTAS);
      expect(new Set(preguntas).size).toBe(CANTIDAD_PREGUNTAS);
      expect(preguntas.at(-1)).toBe(PREGUNTAS.complementan);
    }
  });

  it("apto exterior (IP65, 'exterior' en la descripción) → ¿Sirve para exterior?", () => {
    expect(preguntasSugeridas(productos[0])[0]).toBe(PREGUNTAS.exterior);
    expect(preguntasSugeridas(productos[8])).toContain(PREGUNTAS.exterior);
    // IP20 no es exterior.
    expect(preguntasSugeridas(productos[1])).not.toContain(PREGUNTAS.exterior);
  });

  it("iluminación → ¿Qué potencia necesito para mi espacio?", () => {
    expect(preguntasSugeridas(productos[0])).toContain(PREGUNTAS.potencia);
    expect(preguntasSugeridas(productos[2])).toContain(PREGUNTAS.potencia);
  });

  it("tira led → la fuente; baja tensión que no es tira → el transformador", () => {
    expect(preguntasSugeridas(productos[1])[0]).toBe(PREGUNTAS.fuenteTira);
    expect(preguntasSugeridas({ name: "DICROICA LED 5W MR16 12V" })[0]).toBe(PREGUNTAS.transformador);
  });

  it("zócalo → compatibilidad con el portalámparas", () => {
    expect(preguntasSugeridas(productos[3])).toEqual([PREGUNTAS.potencia, PREGUNTAS.portalamparas, PREGUNTAS.complementan]);
  });

  it("una fuente no pregunta qué fuente necesita ni la potencia de la luz", () => {
    const p = preguntasSugeridas(productos[4]);
    expect(p).not.toContain(PREGUNTAS.transformador);
    expect(p).not.toContain(PREGUNTAS.potencia);
  });

  it("material eléctrico → sección de cable, no potencia de luz", () => {
    for (const p of [productos[5], productos[6]]) {
      const preguntas = preguntasSugeridas(p);
      expect(preguntas[0]).toBe(PREGUNTAS.seccionCable);
      expect(preguntas).not.toContain(PREGUNTAS.potencia);
    }
  });

  it("sin pistas → las genéricas", () => {
    expect(preguntasSugeridas(productos[7])).toEqual([PREGUNTAS.instalacion, PREGUNTAS.similares, PREGUNTAS.complementan]);
  });

  it("sin tono en el nombre pregunta qué tono conviene; con tono, no", () => {
    expect(preguntasSugeridas({ name: "PLAFON LED 24W" })).toContain(PREGUNTAS.tono);
    expect(preguntasSugeridas({ name: "PLAFON LED 24W CALIDO" })).not.toContain(PREGUNTAS.tono);
  });

  it("todas en primera persona, compatibles con usted (sin voseo ni tuteo)", () => {
    expect(Object.values(PREGUNTAS).filter((p) => REGISTRO.test(p))).toEqual([]);
  });
});
