import { describe, expect, it, vi } from "vitest";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { combinar, intencionHeuristica, type AporteJev, type EntradaCombinar } from "./combinar";

const arbol: NodoArbol[] = [
  { id: "i", parentId: null, nombre: "ILUMINACION", orden: 1 },
  { id: "r", parentId: "i", nombre: "Reflectores", orden: 1 },
  { id: "l", parentId: "i", nombre: "Lámparas", orden: 2 },
  { id: "b", parentId: "l", nombre: "Bulbos", orden: 1 },
  { id: "s", parentId: null, nombre: "SEGURIDAD", orden: 2 },
  { id: "c", parentId: "s", nombre: "Camaras", orden: 1 },
  { id: "w", parentId: "s", nombre: "Camara wifi", orden: 2 },
];

const base = (cambios: Partial<EntradaCombinar> = {}): EntradaCombinar => ({
  consulta: "reflector para el patio",
  consultaNorm: "reflector para el patio",
  arbol,
  diccionario: { categorias: [], atributosExplicitos: [], atributosContexto: [], absorbidos: new Set() },
  terminos: [{ texto: "reflector", peso: 1 }],
  jev: null,
  conteoAtributos: {},
  contar: async () => 10,
  ...cambios,
});

const jev = (a: Partial<AporteJev>): AporteJev => ({ atributos: [], ...a });

describe("combinar: categorías", () => {
  it("dura con Jev ≥ 0,9 y la subcategoría también ≥ 0,9 (y conteo > 0)", async () => {
    const p = await combinar(
      base({ jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.99 }, sub: { nombre: "Reflectores", confianza: 0.95 } }) }),
    );
    expect(p.duros.categorias).toEqual(["Reflectores"]);
    // La raíz contiene a la dura: no se suma blanda.
    expect(p.blandos.categorias).toEqual([]);
    expect(p.fuente).toBe("jev");
  });

  it("dura con Jev ≥ 0,9 y acuerdo del diccionario aunque la sub dude", async () => {
    const p = await combinar(
      base({
        diccionario: { categorias: ["Reflectores"], atributosExplicitos: [], atributosContexto: [], absorbidos: new Set() },
        jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.95 }, sub: { nombre: "Reflectores", confianza: 0.6 } }),
      }),
    );
    expect(p.duros.categorias).toEqual(["Reflectores"]);
  });

  it("sin segunda evidencia queda blanda con peso = confianza (y la raíz a la mitad)", async () => {
    const p = await combinar(
      base({ jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.99 }, sub: { nombre: "Reflectores", confianza: 0.52 } }) }),
    );
    expect(p.duros.categorias).toEqual([]);
    expect(p.blandos.categorias).toEqual([
      { nombre: "Reflectores", peso: 0.52 },
      { nombre: "ILUMINACION", peso: 0.5 },
    ]);
  });

  it("con conteo 0 no filtra: queda blanda", async () => {
    const contar = vi.fn(async ({ categorias }: { categorias: string[] }) => (categorias.includes("Camara wifi") ? 0 : 10));
    const p = await combinar(
      base({ contar, jev: jev({ raiz: { nombre: "SEGURIDAD", confianza: 1 }, sub: { nombre: "Camara wifi", confianza: 0.92 } }) }),
    );
    expect(p.duros.categorias).toEqual([]);
    expect(p.blandos.categorias[0]).toEqual({ nombre: "Camara wifi", peso: 0.92 });
    expect(contar).toHaveBeenCalledWith({ categorias: ["Camara wifi"], atributos: [], terminos: ["reflector"] });
  });

  it("raíz < 0,9 nunca es dura", async () => {
    const p = await combinar(
      base({ jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.89 }, sub: { nombre: "Reflectores", confianza: 0.99 } }) }),
    );
    expect(p.duros.categorias).toEqual([]);
  });

  it("sin Jev: candidatas del diccionario como blandas, nada duro", async () => {
    const p = await combinar(
      base({ diccionario: { categorias: ["Reflectores"], atributosExplicitos: [], atributosContexto: [], absorbidos: new Set() } }),
    );
    expect(p.duros.categorias).toEqual([]);
    expect(p.blandos.categorias).toEqual([{ nombre: "Reflectores", peso: 0.8 }]);
    expect(p.fuente).toBe("deterministico");
  });

  it("con Jev, el diccionario sólo suma candidatas dentro de la raíz elegida", async () => {
    const p = await combinar(
      base({
        diccionario: { categorias: ["Camaras", "Bulbos"], atributosExplicitos: [], atributosContexto: [], absorbidos: new Set() },
        jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.8 } }),
      }),
    );
    expect(p.blandos.categorias.map((c) => c.nombre)).toEqual(["Bulbos", "ILUMINACION"]);
  });
});

describe("combinar: atributos e intención", () => {
  it("explícito con conteo ≥ 3 es duro; con menos, blando", async () => {
    const dic = { categorias: [], atributosExplicitos: ["tono-calido", "zocalo-e27"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(base({ diccionario: dic, conteoAtributos: { "tono-calido": 3, "zocalo-e27": 2 } }));
    expect(p.duros.atributos).toEqual(["tono-calido"]);
    expect(p.blandos.atributos).toEqual([{ id: "zocalo-e27", peso: 0.9 }]);
  });

  it("tono y ambiente de Jev siempre blandos; lo escrito le gana a Jev en el mismo grupo", async () => {
    const dic = { categorias: [], atributosExplicitos: ["tono-calido"], atributosContexto: ["apto-exterior"], absorbidos: new Set<string>() };
    const p = await combinar(
      base({
        diccionario: dic,
        conteoAtributos: { "tono-calido": 50 },
        jev: jev({
          atributos: [
            { id: "tono-frio", confianza: 0.99 },
            { id: "apto-exterior", confianza: 0.95 },
          ],
        }),
      }),
    );
    expect(p.duros.atributos).toEqual(["tono-calido"]);
    expect(p.blandos.atributos).toEqual([{ id: "apto-exterior", peso: 0.95 }]);
  });

  it("pregunta (≥ 0,7): sin duros aunque haya evidencia", async () => {
    const dic = { categorias: ["Reflectores"], atributosExplicitos: ["tono-calido"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(
      base({
        diccionario: dic,
        conteoAtributos: { "tono-calido": 50 },
        jev: jev({
          intencion: { valor: "pregunta", confianza: 0.99 },
          raiz: { nombre: "ILUMINACION", confianza: 0.99 },
          sub: { nombre: "Reflectores", confianza: 0.99 },
        }),
      }),
    );
    expect(p.intencion).toBe("pregunta");
    expect(p.duros).toEqual({ categorias: [], atributos: [] });
    expect(p.blandos.categorias[0]).toEqual({ nombre: "Reflectores", peso: 0.99 });
  });

  it("Jev dice código pero la regex no: producto; intención dudosa: heurística", async () => {
    expect((await combinar(base({ jev: jev({ intencion: { valor: "codigo", confianza: 0.99 } }) }))).intencion).toBe("producto");
    // "reflector para el patio" empieza nombrando un producto.
    expect((await combinar(base({ jev: jev({ intencion: { valor: "pregunta", confianza: 0.6 } }) }))).intencion).toBe("producto");
  });

  it("heurística de intención", () => {
    expect(intencionHeuristica("¿qué potencia?", "que potencia")).toBe("pregunta");
    expect(intencionHeuristica("cómo instalo", "como instalo")).toBe("pregunta");
    expect(intencionHeuristica("luz para el patio", "luz para el patio", [{ texto: "luz", peso: 0.3 }])).toBe("necesidad");
    expect(intencionHeuristica("aplique para el baño", "aplique para el bano", [{ texto: "aplique", peso: 1 }])).toBe("producto");
    expect(intencionHeuristica("reflector 50w", "reflector 50w")).toBe("producto");
  });
});
