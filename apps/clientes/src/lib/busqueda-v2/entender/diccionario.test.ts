import { describe, expect, it } from "vitest";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { candidatos } from "./diccionario";

const arbol: NodoArbol[] = [
  { id: "e", parentId: null, nombre: "ELECTRICIDAD", orden: 1 },
  { id: "t", parentId: "e", nombre: "Interruptores termomagnéticos", orden: 1 },
  { id: "l", parentId: "e", nombre: "Llaves, tomas y accesorios", orden: 2 },
  { id: "x", parentId: "e", nombre: "Extractores de aire", orden: 3 },
  { id: "c", parentId: "e", nombre: "Calefacción y cortinas de aire", orden: 4 },
  { id: "i", parentId: null, nombre: "ILUMINACION", orden: 2 },
  { id: "ie", parentId: "i", nombre: "Luminarias exteriores", orden: 1 },
  { id: "ir", parentId: "i", nombre: "Reflectores", orden: 2 },
  { id: "il", parentId: "i", nombre: "Luces de emergencia", orden: 3 },
  { id: "s", parentId: null, nombre: "SEGURIDAD", orden: 3 },
  { id: "sc", parentId: "s", nombre: "Camaras", orden: 1 },
];

describe("candidatos del diccionario", () => {
  it("un sinónimo no propone la categoría de su sustantivo: 'tecla' (→ interruptor) no es Interruptores termomagnéticos", () => {
    expect(candidatos("tecla inalambrica", arbol).categorias).not.toContain("Interruptores termomagnéticos");
    expect(candidatos("tecla", arbol).categorias).not.toContain("Interruptores termomagnéticos");
  });

  it("un sinónimo no ambiguo sí la propone: 'calefactor' (→ calefacción) es Calefacción", () => {
    expect(candidatos("calefactor para el baño", arbol).categorias).toContain("Calefacción y cortinas de aire");
  });

  it("el sustantivo escrito sí la propone", () => {
    expect(candidatos("interruptor 2x20", arbol).categorias).toContain("Interruptores termomagnéticos");
    expect(candidatos("extractor para baño", arbol).categorias).toContain("Extractores de aire");
  });

  it("un lugar exterior sugiere apto exterior (blando de contexto)", () => {
    for (const lugar of ["patio", "terraza", "balcon", "galeria"]) {
      expect(candidatos(`luz para la ${lugar}`, arbol).atributosContexto).toEqual(["apto-exterior"]);
    }
    expect(candidatos("luz para el living", arbol).atributosContexto).toEqual([]);
  });

  it("baño, ducha o lavadero sugieren apto humedad (IP44 o más), no apto exterior", () => {
    for (const q of ["lampara para el bano", "aplique para el bano", "luz para la ducha", "luz para el lavadero"]) {
      expect(candidatos(q, arbol).atributosContexto).toEqual(["apto-humedad"]);
    }
  });

  it("un lugar húmedo y uno exterior suman los dos; escribir 'exterior' no suma el de contexto", () => {
    expect(candidatos("luz para el bano y el patio", arbol).atributosContexto).toEqual(["apto-exterior", "apto-humedad"]);
    expect(candidatos("luz exterior para el patio", arbol).atributosContexto).toEqual([]);
  });

  describe("luz + lugar sin otra palabra de producto ('luz para el patio')", () => {
    it("propone la categoría de la luz, no la de emergencia ni la de seguridad", () => {
      const cat = candidatos("luz para el patio", arbol).categoriasDeLuz;
      expect(cat).toContain("ILUMINACION");
      expect(cat).not.toContain("Luces de emergencia");
      expect(cat).not.toContain("Camaras");
      expect(candidatos("luz para el patio", arbol).categorias).not.toContain("ILUMINACION");
    });

    it("con un lugar de intemperie propone también la luminaria exterior; con uno de interior, no", () => {
      for (const q of ["luz para el patio", "luz para el jardin", "iluminar la terraza", "luz para el patio que no se moje"]) {
        expect(candidatos(q, arbol).categoriasDeLuz).toEqual(expect.arrayContaining(["ILUMINACION", "Luminarias exteriores"]));
      }
      expect(candidatos("luz para el living", arbol).categoriasDeLuz).toContain("ILUMINACION");
      expect(candidatos("luz para el living", arbol).categoriasDeLuz).not.toContain("Luminarias exteriores");
    });

    it("la medida no la anula ('luz 20w para el patio')", () => {
      expect(candidatos("luz 20w para el patio", arbol).categoriasDeLuz).toContain("ILUMINACION");
    });

    it("una palabra de producto o un sinónimo la anula: no hay categoría de luz", () => {
      expect(candidatos("llave de luz", arbol).categoriasDeLuz).toEqual([]);
      expect(candidatos("luz que se prenda sola", arbol).categoriasDeLuz).toEqual([]);
      expect(candidatos("luz de emergencia para cortes de luz", arbol).categoriasDeLuz).toEqual([]);
    });

    it("sin lugar tampoco: 'luz' sola o 'luz led' no proponen la raíz", () => {
      expect(candidatos("luz", arbol).categoriasDeLuz).toEqual([]);
      expect(candidatos("luz led", arbol).categoriasDeLuz).toEqual([]);
    });

    it("'camara para el patio' sigue proponiendo Cámaras y no la categoría de la luz", () => {
      const cat = candidatos("camara para el patio", arbol).categorias;
      expect(cat).toContain("Camaras");
      expect(candidatos("camara para el patio", arbol).categoriasDeLuz).toEqual([]);
    });
  });
});
