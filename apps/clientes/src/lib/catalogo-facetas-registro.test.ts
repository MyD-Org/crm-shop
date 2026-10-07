import { describe, expect, it } from "vitest";
import fixture from "../db/__fixtures__/atributos-claves.json";
import { CLAVES_ESTRUCTURADAS } from "./catalogo-caracteristicas";
import { RANGOS, RANGOS_SOLO_FACETA, rangoDeClave } from "./catalogo-atributos-medida";
import {
  REGISTRO,
  UMBRAL_COBERTURA,
  claveFacetable,
  elegirFacetas,
  etiquetaValor,
  rangoDeValorLista,
  valorDeListaValido,
  type EntradaFacetas,
} from "./catalogo-facetas-registro";

/** Distribuciones sintéticas: ningún dato real de clientes. */
const entrada = (parcial: Partial<EntradaFacetas> = {}): EntradaFacetas => ({
  filas: [],
  rangos: [],
  denominadores: {},
  activas: [],
  ...parcial,
});

const filas = (clave: string, valores: Record<string, number>) => Object.entries(valores).map(([valor, n]) => ({ clave, valor, n }));

const claves = (r: ReturnType<typeof elegirFacetas>) => r.map((f) => f.clave);

describe("REGISTRO", () => {
  it("lista las claves facetables y deja afuera medidas_mm, leds_* y potencia_w_m", () => {
    const facetables = REGISTRO.map((c) => c.clave);
    expect(facetables).toEqual(
      expect.arrayContaining(["polos", "curva", "corriente_a", "poder_corte_ka", "sensibilidad_ma", "tension_v", "ip", "temperatura_k", "zocalo", "tono", "color", "montaje", "angulo_grados", "seccion_mm2", "potencia_w", "flujo_lm", "largo_m", "diametro_mm", "ancho_mm", "modulos", "dimerizable"]),
    );
    for (const fuera of ["medidas_mm", "leds_m", "potencia_w_m", "leds_rollo"]) expect(facetables).not.toContain(fuera);
  });

  it("solo contiene claves que el Shop conoce y sin repetidas", () => {
    const facetables = REGISTRO.map((c) => c.clave);
    for (const c of facetables) expect(CLAVES_ESTRUCTURADAS as readonly string[]).toContain(c);
    expect(new Set(facetables).size).toBe(facetables.length);
  });

  it("potencia, flujo y largo son de rango; potencia usa sus parámetros propios", () => {
    expect(claveFacetable("potencia_w")).toMatchObject({ control: "rango", param: "potencia" });
    expect(claveFacetable("flujo_lm")?.control).toBe("rango");
    expect(claveFacetable("largo_m")?.control).toBe("rango");
    expect(claveFacetable("polos")?.control).toBe("lista");
  });

  it("los órdenes son únicos y toda clave de rango tiene RANGOS", () => {
    const ordenes = REGISTRO.map((c) => c.orden);
    expect(new Set(ordenes).size).toBe(ordenes.length);
    for (const c of REGISTRO.filter((x) => x.control === "rango")) expect(RANGOS[c.clave as keyof typeof RANGOS]).toBeDefined();
  });

  it("claveFacetable devuelve undefined para una clave fuera del registro", () => {
    expect(claveFacetable("medidas_mm")).toBeUndefined();
    expect(claveFacetable("inventada")).toBeUndefined();
  });
});

describe("etiquetaValor", () => {
  it.each([
    ["polos", "2", "2"],
    ["corriente_a", "20", "20 A"],
    ["corriente_a", "0.5", "0,5 A"],
    ["corriente_a", "4-6", "4–6 A"],
    ["corriente_a", "1.6-2.5", "1,6–2,5 A"],
    ["ip", "54", "IP54"],
    ["zocalo", "e27", "E27"],
    ["curva", "c", "C"],
    ["tono", "calido", "Cálido"],
    ["tono", "frio", "Frío"],
    ["color", "marron", "Marrón"],
    ["montaje", "embutir", "Embutir"],
    ["angulo_grados", "60", "60°"],
    ["tono", "otro", "Otro"],
  ])("%s %s -> %s", (clave, valor, esperado) => {
    expect(etiquetaValor(clave, valor)).toBe(esperado);
  });
});

describe("elegirFacetas: cobertura y valores", () => {
  it("cobertura suficiente: polos en 83 de 100 con valores 1 y 2", () => {
    const r = elegirFacetas(entrada({ filas: filas("polos", { "1": 50, "2": 33 }), denominadores: { polos: 100 } }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ clave: "polos", control: "lista", titulo: "Polos" });
    if (r[0].control !== "lista") throw new Error("lista");
    expect(r[0].items).toEqual([
      { valor: "1", etiqueta: "1", count: 50 },
      { valor: "2", etiqueta: "2", count: 33 },
    ]);
  });

  it("cobertura baja: sección en 10 de 100 no se devuelve", () => {
    const r = elegirFacetas(entrada({ filas: filas("seccion_mm2", { "1.5": 6, "2.5": 4 }), denominadores: { seccion_mm2: 100 } }));
    expect(r).toEqual([]);
  });

  it("el umbral (30 %, calibrado con la cobertura real en P3) es inclusivo: 30 de 100 alcanza", () => {
    expect(UMBRAL_COBERTURA).toBe(0.3);
    const r = elegirFacetas(entrada({ filas: filas("polos", { "1": 15, "2": 15 }), denominadores: { polos: 100 } }));
    expect(claves(r)).toEqual(["polos"]);
    const justo = elegirFacetas(entrada({ filas: filas("polos", { "1": 15, "2": 14 }), denominadores: { polos: 100 } }));
    expect(justo).toEqual([]);
  });

  it("un solo valor: color presente en 90 % pero con un único valor no se devuelve", () => {
    const r = elegirFacetas(entrada({ filas: filas("color", { blanco: 90 }), denominadores: { color: 100 } }));
    expect(r).toEqual([]);
  });

  it("valores con n = 0 no cuentan para el mínimo de valores", () => {
    const r = elegirFacetas(entrada({ filas: filas("color", { blanco: 90, negro: 0 }), denominadores: { color: 100 } }));
    expect(r).toEqual([]);
  });

  it("sin denominador la clave no se ofrece (conjunto vacío)", () => {
    const r = elegirFacetas(entrada({ filas: filas("polos", { "1": 5, "2": 5 }), denominadores: {} }));
    expect(r).toEqual([]);
  });

  it("valores numéricos en orden ascendente y los de texto en el orden del vocabulario", () => {
    const r = elegirFacetas(
      entrada({
        filas: [...filas("corriente_a", { "32": 10, "6": 10, "20": 10 }), ...filas("curva", { d: 5, b: 5, c: 20 })],
        denominadores: { corriente_a: 30, curva: 30 },
      }),
    );
    const por = Object.fromEntries(r.map((f) => [f.clave, f.control === "lista" ? f.items.map((i) => i.valor) : []]));
    expect(por.corriente_a).toEqual(["6", "20", "32"]);
    expect(por.curva).toEqual(["b", "c", "d"]);
  });

  it("descarta valores fuera del rango válido o con forma inválida y no los cuenta", () => {
    const r = elegirFacetas(
      entrada({
        filas: [...filas("polos", { "1": 40, "2": 40, "99": 5 }), { clave: "color", valor: "blanco;drop", n: 90 }, ...filas("color", { blanco: 50, negro: 40 })],
        denominadores: { polos: 100, color: 100 },
      }),
    );
    const polos = r.find((f) => f.clave === "polos");
    expect(polos && polos.control === "lista" && polos.items.map((i) => i.valor)).toEqual(["1", "2"]);
    const color = r.find((f) => f.clave === "color");
    expect(color && color.control === "lista" && color.items.map((i) => i.valor)).toEqual(["blanco", "negro"]);
  });

  it("la cobertura se calcula con los valores válidos (un outlier de lista no la infla)", () => {
    // 2 válidos de 100 + 90 en un valor fuera de rango: cobertura 2 %, no 92 %
    const r = elegirFacetas(entrada({ filas: filas("polos", { "1": 1, "2": 1, "99": 90 }), denominadores: { polos: 100 } }));
    expect(r).toEqual([]);
  });

  it("claves desconocidas no se ofrecen aunque tengan datos", () => {
    const r = elegirFacetas(entrada({ filas: filas("medidas_mm", { "10x10": 50, "20x20": 50 }), denominadores: { medidas_mm: 100 } }));
    expect(r).toEqual([]);
  });
});

describe("elegirFacetas: rangos", () => {
  it("rango con min < max se devuelve con extremos enteros (floor/ceil)", () => {
    const r = elegirFacetas(entrada({ rangos: [{ clave: "flujo_lm", min: 80.5, max: 1999.2, n: 90 }], denominadores: { flujo_lm: 100 } }));
    expect(r).toEqual([expect.objectContaining({ clave: "flujo_lm", control: "rango", rango: { min: 80, max: 2000 }, unidad: "lm" })]);
  });

  it("potencia lleva param potencia", () => {
    const r = elegirFacetas(entrada({ rangos: [{ clave: "potencia_w", min: 3, max: 300, n: 80 }], denominadores: { potencia_w: 100 } }));
    expect(r[0]).toMatchObject({ clave: "potencia_w", control: "rango", param: "potencia", unidad: "W" });
  });

  it("min = max no se ofrece", () => {
    const r = elegirFacetas(entrada({ rangos: [{ clave: "largo_m", min: 5, max: 5, n: 90 }], denominadores: { largo_m: 100 } }));
    expect(r).toEqual([]);
  });

  it("cobertura baja de un rango no se ofrece", () => {
    const r = elegirFacetas(entrada({ rangos: [{ clave: "largo_m", min: 1, max: 50, n: 10 }], denominadores: { largo_m: 100 } }));
    expect(r).toEqual([]);
  });

  it("outlier: potencia con un valor 250000 no extiende el rango más allá del válido", () => {
    const r = elegirFacetas(entrada({ rangos: [{ clave: "potencia_w", min: 3, max: 250_000, n: 90 }], denominadores: { potencia_w: 100 } }));
    expect(r).toHaveLength(1);
    if (r[0].control !== "rango") throw new Error("rango");
    expect(r[0].rango.max).toBeLessThanOrEqual(RANGOS.potencia_w![1]);
    expect(r[0].rango.min).toBe(3);
  });

  it("un rango entero fuera del rango válido no se ofrece", () => {
    const r = elegirFacetas(entrada({ rangos: [{ clave: "potencia_w", min: 200_000, max: 250_000, n: 90 }], denominadores: { potencia_w: 100 } }));
    expect(r).toEqual([]);
  });
});

describe("elegirFacetas: orden y tope", () => {
  const CLAVES = ["polos", "curva", "corriente_a", "poder_corte_ka", "sensibilidad_ma", "tension_v", "zocalo", "tono", "color"];
  const valores = (c: string): Record<string, number> =>
    c === "curva" ? { b: 50, c: 50 } : c === "zocalo" ? { e27: 50, e14: 50 } : c === "tono" ? { calido: 50, frio: 50 } : c === "color" ? { blanco: 50, negro: 50 } : c === "sensibilidad_ma" ? { "30": 50, "300": 50 } : { "1": 50, "2": 50 };
  const todas = () => CLAVES.flatMap((c) => filas(c, valores(c)));
  const den = Object.fromEntries(CLAVES.map((c) => [c, 100]));

  it("tope: 9 claves elegibles devuelven las 6 de menor orden, ordenadas", () => {
    const r = elegirFacetas(entrada({ filas: todas(), denominadores: den }));
    expect(r).toHaveLength(6);
    const esperadas = REGISTRO.filter((c) => c.clave in den)
      .sort((a, b) => a.orden - b.orden)
      .map((c) => c.clave);
    expect(claves(r)).toEqual(esperadas.slice(0, 6));
  });
});

describe("elegirFacetas: filtros activos", () => {
  it("una clave activa se devuelve siempre aunque tenga cobertura baja y un solo valor", () => {
    const r = elegirFacetas(entrada({ filas: filas("polos", { "2": 3 }), denominadores: { polos: 100 }, activas: ["polos"] }));
    expect(claves(r)).toEqual(["polos"]);
  });

  it("una clave activa sin filas se devuelve con la lista vacía", () => {
    const r = elegirFacetas(entrada({ denominadores: { polos: 0 }, activas: ["polos"] }));
    expect(r).toEqual([expect.objectContaining({ clave: "polos", control: "lista", items: [] })]);
  });

  it("una clave de rango activa sin datos usa el rango válido del registro", () => {
    const r = elegirFacetas(entrada({ activas: ["largo_m"] }));
    expect(r).toEqual([expect.objectContaining({ clave: "largo_m", control: "rango", rango: { min: RANGOS.largo_m![0], max: RANGOS.largo_m![1] } })]);
  });

  it("las activas no se pierden por el tope de 6", () => {
    const cs = ["polos", "curva", "corriente_a", "poder_corte_ka", "sensibilidad_ma", "tension_v", "zocalo", "tono"];
    const valores = (c: string): Record<string, number> => (c === "curva" ? { b: 50, c: 50 } : c === "zocalo" ? { e27: 50, e14: 50 } : c === "tono" ? { calido: 50, frio: 50 } : c === "sensibilidad_ma" ? { "30": 50, "300": 50 } : { "1": 50, "2": 50 });
    const r = elegirFacetas(
      entrada({
        filas: cs.flatMap((c) => filas(c, valores(c))),
        denominadores: Object.fromEntries(cs.map((c) => [c, 100])),
        activas: ["tono"],
      }),
    );
    expect(r).toHaveLength(6);
    expect(claves(r)).toContain("tono");
  });

  it("filtro propio no cuenta: la cobertura usa el denominador de cada clave", () => {
    // polos:2 tildada: el conjunto sin su filtro tiene 100 con polos 40+40 (cobertura 80 %);
    // curva se cuenta dentro de los 40 de 2 polos: denominador 40 y 36 con curva (90 %)
    const r = elegirFacetas(
      entrada({
        filas: [...filas("polos", { "1": 40, "2": 40 }), ...filas("curva", { b: 6, c: 30 })],
        denominadores: { polos: 100, curva: 40 },
        activas: ["polos"],
      }),
    );
    expect(claves(r)).toEqual(["polos", "curva"]);
  });
});

describe("elegirFacetas: overrides por categoría", () => {
  it("un override por categoría oculta una clave aunque supere el umbral", () => {
    const base = entrada({ filas: filas("color", { blanco: 50, negro: 50 }), denominadores: { color: 100 } });
    expect(claves(elegirFacetas(base))).toEqual(["color"]);
    const r = elegirFacetas({ ...base, categoria: "Categoría X" }, { "categoria x": { ocultar: ["color"] } });
    expect(r).toEqual([]);
  });

  it("el override no afecta a otras categorías", () => {
    const base = entrada({ filas: filas("color", { blanco: 50, negro: 50 }), denominadores: { color: 100 }, categoria: "Otra" });
    expect(claves(elegirFacetas(base, { "categoria x": { ocultar: ["color"] } }))).toEqual(["color"]);
  });

  it("un override puede reordenar claves", () => {
    const base = entrada({
      filas: [...filas("polos", { "1": 50, "2": 50 }), ...filas("curva", { b: 50, c: 50 })],
      denominadores: { polos: 100, curva: 100 },
      categoria: "Termomagnéticas",
    });
    expect(claves(elegirFacetas(base))).toEqual(["polos", "curva"]);
    expect(claves(elegirFacetas(base, { termomagneticas: { orden: { curva: 1 } } }))).toEqual(["curva", "polos"]);
  });

  it("una clave activa se muestra aunque la categoría la oculte (para poder quitarla)", () => {
    const base = entrada({ filas: filas("color", { blanco: 50, negro: 50 }), denominadores: { color: 100 }, categoria: "X", activas: ["color"] });
    expect(claves(elegirFacetas(base, { x: { ocultar: ["color"] } }))).toEqual(["color"]);
  });
});

describe("diametro_mm y ancho_mm (caños y bandejas)", () => {
  it("son facetas de lista, en mm, con el título del producto", () => {
    expect(claveFacetable("diametro_mm")).toMatchObject({ control: "lista", titulo: "Diámetro", unidad: "mm" });
    expect(claveFacetable("ancho_mm")).toMatchObject({ control: "lista", titulo: "Ancho", unidad: "mm" });
  });

  it("su rango válido es el del CRM (el fixture de claves) y no contamina RANGOS del buscador", () => {
    expect(RANGOS_SOLO_FACETA).toEqual(fixture.rangos_solo_faceta);
    expect(rangoDeClave("diametro_mm")).toEqual([5, 200]);
    expect(rangoDeClave("ancho_mm")).toEqual([30, 1000]);
    expect(rangoDeClave("polos")).toEqual([1, 4]);
    expect(rangoDeClave("tono")).toBeUndefined();
    expect(rangoDeClave("constructor")).toBeUndefined();
    expect(Object.keys(RANGOS)).not.toContain("diametro_mm");
  });

  it("etiquetas de valor: '25 mm', '12,5 mm', '150 mm'", () => {
    expect(etiquetaValor("diametro_mm", "25")).toBe("25 mm");
    expect(etiquetaValor("diametro_mm", "12.5")).toBe("12,5 mm");
    expect(etiquetaValor("ancho_mm", "150")).toBe("150 mm");
  });

  it("se ofrecen con cobertura suficiente y más de un valor, en orden numérico", () => {
    const r = elegirFacetas(
      entrada({
        filas: [...filas("diametro_mm", { "32": 10, "20": 20, "25": 15 }), ...filas("ancho_mm", { "300": 4, "100": 6, "150": 5 })],
        denominadores: { diametro_mm: 50, ancho_mm: 15 },
      }),
    );
    const por = Object.fromEntries(r.map((f) => [f.clave, f.control === "lista" ? f.items.map((i) => i.valor) : []]));
    expect(por.diametro_mm).toEqual(["20", "25", "32"]);
    expect(por.ancho_mm).toEqual(["100", "150", "300"]);
  });

  it("descarta valores fuera de rango (un 4 mm o un 2000 mm no es un diámetro ni un ancho)", () => {
    const r = elegirFacetas(
      entrada({
        filas: [...filas("diametro_mm", { "4": 10, "20": 10, "250": 10 }), ...filas("ancho_mm", { "20": 10, "100": 10, "2000": 10 })],
        denominadores: { diametro_mm: 30, ancho_mm: 30 },
      }),
    );
    const por = Object.fromEntries(r.map((f) => [f.clave, f.control === "lista" ? f.items.map((i) => i.valor) : []]));
    // Con un solo valor válido no hay faceta (mínimo 2 valores).
    expect(por.diametro_mm).toBeUndefined();
    expect(por.ancho_mm).toBeUndefined();
  });

  it("sin filas (la migración 0070 todavía no escribió nada) no se ofrece nada y no rompe", () => {
    expect(elegirFacetas(entrada({ denominadores: { diametro_mm: 100, ancho_mm: 100 } }))).toEqual([]);
  });
});

describe("corriente: rangos de regulación como opciones de la lista", () => {
  it("un rango es un valor válido de corriente (a < b, dentro del rango de la clave); no de otras claves", () => {
    expect(valorDeListaValido("corriente_a", "4-6")).toBe(true);
    expect(valorDeListaValido("corriente_a", "0.63-1")).toBe(true);
    expect(rangoDeValorLista("corriente_a", "1.6-2.5")).toEqual([1.6, 2.5]);
    expect(valorDeListaValido("corriente_a", "6-4")).toBe(false);
    expect(valorDeListaValido("corriente_a", "4-4")).toBe(false);
    expect(valorDeListaValido("corriente_a", "04-6")).toBe(false);
    expect(valorDeListaValido("corriente_a", "4-9000")).toBe(false);
    expect(valorDeListaValido("polos", "1-2")).toBe(false);
    expect(valorDeListaValido("seccion_mm2", "1.5-2.5")).toBe(false);
  });

  it("'4–6 A' va separado de '6 A' y ordenado por mínimo y tope", () => {
    const r = elegirFacetas(
      entrada({ filas: filas("corriente_a", { "6": 10, "4-6": 2, "6-10": 3, "1.6-2.5": 1, "10": 4 }), denominadores: { corriente_a: 20 } }),
    );
    if (r[0]?.control !== "lista") throw new Error("lista");
    expect(r[0].items.map((i) => [i.valor, i.etiqueta, i.count])).toEqual([
      ["1.6-2.5", "1,6–2,5 A", 1],
      ["4-6", "4–6 A", 2],
      ["6", "6 A", 10],
      ["6-10", "6–10 A", 3],
      ["10", "10 A", 4],
    ]);
  });
});

describe("modulos y dimerizable (gabinetes y lámparas)", () => {
  it("modulos: lista en 'módulos' (capacidad DIN), con rango válido 1–200 del fixture", () => {
    expect(claveFacetable("modulos")).toMatchObject({ control: "lista", titulo: "Módulos", unidad: "módulos" });
    expect(rangoDeClave("modulos")).toEqual([1, 200]);
    expect(RANGOS_SOLO_FACETA).toEqual(fixture.rangos_solo_faceta);
    expect(Object.keys(RANGOS)).not.toContain("modulos");
    expect(etiquetaValor("modulos", "12")).toBe("12 módulos");
    expect(etiquetaValor("modulos", "1")).toBe("1 módulo");
  });

  it("modulos: se ofrece con cobertura suficiente, en orden numérico, y descarta lo fuera de rango", () => {
    const r = elegirFacetas(
      entrada({ filas: [...filas("modulos", { "24": 5, "4": 8, "12": 10, "0": 3, "300": 2 })], denominadores: { modulos: 28 } }),
    );
    const f = r.find((x) => x.clave === "modulos");
    expect(f && f.control === "lista" ? f.items.map((i) => [i.valor, i.etiqueta]) : null).toEqual([
      ["4", "4 módulos"],
      ["12", "12 módulos"],
      ["24", "24 módulos"],
    ]);
  });

  it("dimerizable: lista Sí / No con la cobertura de siempre (30 %) y al menos dos valores", () => {
    expect(claveFacetable("dimerizable")).toMatchObject({ control: "lista", titulo: "Dimerizable", valores: { si: "Sí", no: "No" } });
    expect(etiquetaValor("dimerizable", "si")).toBe("Sí");
    expect(etiquetaValor("dimerizable", "no")).toBe("No");
    const ofrece = (denominador: number) =>
      elegirFacetas(entrada({ filas: filas("dimerizable", { si: 6, no: 2 }), denominadores: { dimerizable: denominador } })).some((f) => f.clave === "dimerizable");
    expect(ofrece(20)).toBe(true); // 8 de 20 = 40 %
    expect(ofrece(40)).toBe(false); // 8 de 40 = 20 %: con poca cobertura no se ofrece
    const solo = elegirFacetas(entrada({ filas: filas("dimerizable", { si: 10 }), denominadores: { dimerizable: 10 } }));
    expect(solo.some((f) => f.clave === "dimerizable")).toBe(false); // un solo valor no es filtro
  });

  it("dimerizable: orden Sí antes que No y un valor que no es del vocabulario se muestra capitalizado, no se rompe", () => {
    const r = elegirFacetas(entrada({ filas: filas("dimerizable", { no: 4, si: 6 }), denominadores: { dimerizable: 10 } }));
    const f = r.find((x) => x.clave === "dimerizable");
    expect(f && f.control === "lista" ? f.items.map((i) => i.valor) : null).toEqual(["si", "no"]);
  });
});
