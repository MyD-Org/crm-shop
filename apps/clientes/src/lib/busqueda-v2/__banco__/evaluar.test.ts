import { describe, expect, it } from "vitest";
import { evaluar, tipoDe, type BusquedaBanco, type ProductoBanco, type ResultadoBanco } from "./banco";

const arbol = [
  { id: "c-raiz", parentId: null, nombre: "Raiz" },
  { id: "c-hijo", parentId: "c-raiz", nombre: "Hijo" },
  { id: "c-otra", parentId: null, nombre: "Otra" },
];

const prod = (name: string, categoriaPropiaId?: string): ProductoBanco => ({ name, categoriaPropiaId });

function resultado(productos: ProductoBanco[], extra: Partial<ResultadoBanco> = {}): ResultadoBanco {
  return {
    categoriasDuras: [],
    categoriasBlandas: [],
    atributosDuros: [],
    expansiones: [],
    productos,
    total: productos.length,
    ...extra,
  };
}

const caso = (p: Partial<BusquedaBanco> = {}): BusquedaBanco => ({ q: "consulta generica", perfil: "particular", ...p });

describe("tipoDe (derivación determinista)", () => {
  it("código por perfil o por intención", () => {
    expect(tipoDe(caso({ perfil: "codigo" }))).toBe("codigo");
    expect(tipoDe(caso({ intencion: "codigo" }))).toBe("codigo");
  });

  it("necesidad y pregunta salen de la intención esperada", () => {
    expect(tipoDe(caso({ intencion: "necesidad" }))).toBe("necesidad");
    expect(tipoDe(caso({ intencion: "pregunta" }))).toBe("pregunta");
  });

  it("el resto es producto", () => {
    expect(tipoDe(caso({ intencion: "producto" }))).toBe("producto");
    expect(tipoDe(caso())).toBe("producto");
  });

  it("un tipo explícito pisa la derivación", () => {
    expect(tipoDe(caso({ intencion: "producto", tipo: "typo" }))).toBe("typo");
    expect(tipoDe(caso({ perfil: "codigo", tipo: "marca" }))).toBe("marca");
  });
});

describe("evaluar: campos nuevos", () => {
  it("copia perfil, tipo derivado e intención esperada", () => {
    const e = evaluar(caso({ perfil: "profesional", intencion: "necesidad" }), resultado([]), arbol);
    expect(e.perfil).toBe("profesional");
    expect(e.tipo).toBe("necesidad");
    expect(e.intencionEsperada).toBe("necesidad");
  });

  it("acepta el perfil 'desconocido' (consultas reales sin clasificar)", () => {
    const e = evaluar(caso({ perfil: "desconocido" }), resultado([]), arbol);
    expect(e.perfil).toBe("desconocido");
  });

  it("rr = 1/posición del primer esperado; 0 si no aparece; null sin expectativa", () => {
    const b = caso({ debeIncluirEnTop24: ["lampara"] });
    expect(evaluar(b, resultado([prod("x"), prod("y"), prod("lampara led")]), arbol).rr).toBeCloseTo(1 / 3, 5);
    expect(evaluar(b, resultado([prod("x")]), arbol).rr).toBe(0);
    expect(evaluar(caso(), resultado([prod("x")]), arbol).rr).toBeNull();
  });

  it("precisión por palabra esperada: relevantes / resultados devueltos", () => {
    const b = caso({ debeIncluirEnTop24: ["cable"] });
    const productos = [...Array.from({ length: 5 }, () => prod("cable x")), ...Array.from({ length: 5 }, () => prod("otro"))];
    expect(evaluar(b, resultado(productos), arbol).precision).toBe(0.5);
  });

  it("precisión por categoría propia dentro de `categoria` (18 de 24 = 75 %), con descendientes", () => {
    const b = caso({ categoria: ["Raiz"] });
    const productos = [
      ...Array.from({ length: 9 }, () => prod("a", "c-raiz")),
      ...Array.from({ length: 9 }, () => prod("b", "c-hijo")),
      ...Array.from({ length: 6 }, () => prod("c", "c-otra")),
    ];
    const e = evaluar(b, resultado(productos), arbol);
    expect(e.precision).toBe(0.75);
    // `categoria` sola no es una expectativa de producto: no hay posición ni rr.
    expect(e.rr).toBeNull();
  });

  it("top vacío: precisión 0 y cuenta como zero-result", () => {
    const e = evaluar(caso({ debeIncluirEnTop24: ["x"] }), resultado([], { total: 0 }), arbol);
    expect(e.precision).toBe(0);
    expect(e.zero).toBe(true);
  });

  it("sin ningún criterio, la precisión es null (se excluye y se cuenta)", () => {
    const e = evaluar(caso({ intencion: "pregunta", sinDuros: true }), resultado([prod("x")]), arbol);
    expect(e.precision).toBeNull();
  });

  it("zero: total == 0 en cualquier caso, también sin nuncaSinResultados", () => {
    expect(evaluar(caso(), resultado([], { total: 0 }), arbol).zero).toBe(true);
    expect(evaluar(caso(), resultado([prod("x")]), arbol).zero).toBe(false);
  });

  it("peso y ms viajan a la evaluación", () => {
    const e = evaluar(caso({ peso: 7 }), resultado([prod("x")], { ms: 42 }), arbol);
    expect(e.peso).toBe(7);
    expect(e.ms).toBe(42);
  });

  it("no cambia lo que ya medía (puntos, posición, indebido)", () => {
    const e = evaluar(
      caso({ debeIncluirEnTop24: ["lampara"], nuncaSinResultados: true }),
      resultado([prod("lampara e27")]),
      arbol,
    );
    expect(e).toMatchObject({ top24Ok: true, posicion: 1, sinResultadosIndebido: false, puntos: 4, posibles: 4 });
  });
});
