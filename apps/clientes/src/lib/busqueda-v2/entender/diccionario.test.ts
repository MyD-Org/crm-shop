import { describe, expect, it } from "vitest";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { candidatos } from "./diccionario";

const arbol: NodoArbol[] = [
  { id: "e", parentId: null, nombre: "ELECTRICIDAD", orden: 1 },
  { id: "t", parentId: "e", nombre: "Interruptores termomagnéticos", orden: 1 },
  { id: "l", parentId: "e", nombre: "Llaves, tomas y accesorios", orden: 2 },
  { id: "x", parentId: "e", nombre: "Extractores de aire", orden: 3 },
  { id: "c", parentId: "e", nombre: "Calefaccion y cortinas de aire", orden: 4 },
];

describe("candidatos del diccionario", () => {
  it("un sinónimo no propone la categoría de su sustantivo: 'tecla' (→ interruptor) no es Interruptores termomagnéticos", () => {
    expect(candidatos("tecla inalambrica", arbol).categorias).not.toContain("Interruptores termomagnéticos");
    expect(candidatos("tecla", arbol).categorias).not.toContain("Interruptores termomagnéticos");
  });

  it("un sinónimo no ambiguo sí la propone: 'calefactor' (→ calefacción) es Calefacción", () => {
    expect(candidatos("calefactor para el baño", arbol).categorias).toContain("Calefaccion y cortinas de aire");
  });

  it("el sustantivo escrito sí la propone", () => {
    expect(candidatos("interruptor 2x20", arbol).categorias).toContain("Interruptores termomagnéticos");
    expect(candidatos("extractor para baño", arbol).categorias).toContain("Extractores de aire");
  });
});
