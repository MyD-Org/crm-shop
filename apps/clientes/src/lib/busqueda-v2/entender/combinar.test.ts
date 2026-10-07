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

describe("combinar: la categoría dura no deja afuera lo que se llama como se pidió", () => {
  // «lampara de escritorio»: Jev elige Lámparas (≥ 0,9) y el diccionario también, pero los veladores
  // de escritorio están en otra categoría.
  const consulta = {
    consulta: "lampara de escritorio",
    consultaNorm: "lampara de escritorio",
    terminos: [
      { texto: "lampara", peso: 1 },
      { texto: "escritorio", peso: 1 },
    ],
    diccionario: { categorias: ["Lámparas"], atributosExplicitos: [], atributosContexto: [], absorbidos: new Set<string>() },
    jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.99 }, sub: { nombre: "Lámparas", confianza: 0.95 } }),
  };
  /** Cuántos productos se llaman «lampara de escritorio»: `fuera` afuera de Lámparas y `dentro` adentro. */
  const conteo = (dentro: number, fuera: number) =>
    vi.fn(async (f: { categorias: string[]; nombreConTodos?: string[] }) => {
      if (!f.nombreConTodos) return 40;
      return f.categorias.includes("Lámparas") ? dentro : dentro + fuera;
    });

  it("hay productos con la frase completa afuera de la categoría: queda blanda (con su peso)", async () => {
    const p = await combinar(base({ ...consulta, contar: conteo(0, 7) }));
    expect(p.duros.categorias).toEqual([]);
    expect(p.blandos.categorias[0]).toEqual({ nombre: "Lámparas", peso: 0.95 });
  });

  it("aunque también haya adentro: si hay alguno afuera, el filtro lo excluiría", async () => {
    const p = await combinar(base({ ...consulta, contar: conteo(3, 4) }));
    expect(p.duros.categorias).toEqual([]);
  });

  it("todos los que se llaman así están adentro (o no hay ninguno): sigue dura", async () => {
    expect((await combinar(base({ ...consulta, contar: conteo(5, 0) }))).duros.categorias).toEqual(["Lámparas"]);
    expect((await combinar(base({ ...consulta, contar: conteo(0, 0) }))).duros.categorias).toEqual(["Lámparas"]);
  });

  it("cuenta con la frase y los atributos duros, sin categoría y con ella (3 conteos en paralelo)", async () => {
    const contar = conteo(0, 7);
    await combinar(base({ ...consulta, contar }));
    expect(contar).toHaveBeenCalledWith({ categorias: ["Lámparas"], atributos: [], terminos: ["lampara", "escritorio"] });
    expect(contar).toHaveBeenCalledWith({ categorias: [], atributos: [], nombreConTodos: ["lampara", "escritorio"] });
    expect(contar).toHaveBeenCalledWith({ categorias: ["Lámparas"], atributos: [], nombreConTodos: ["lampara", "escritorio"] });
    expect(contar).toHaveBeenCalledTimes(3);
  });

  it("una sola palabra significativa no es una frase: no se hacen los conteos de más", async () => {
    const contar = conteo(0, 7);
    const p = await combinar(base({ ...consulta, consulta: "lampara", terminos: [{ texto: "lampara", peso: 1 }], contar }));
    expect(p.duros.categorias).toEqual(["Lámparas"]);
    expect(contar).toHaveBeenCalledTimes(1);
  });

  it("el contexto de pedido no cuenta como parte de la frase; un lugar sí", async () => {
    const pedido = [
      { texto: "lampara", peso: 1 },
      { texto: "quiero", peso: 0.3 },
    ];
    const contar = conteo(0, 7);
    expect((await combinar(base({ ...consulta, terminos: pedido, contar }))).duros.categorias).toEqual(["Lámparas"]);
    const lugar = [
      { texto: "lampara", peso: 1 },
      { texto: "jardin", peso: 0.3 },
    ];
    expect((await combinar(base({ ...consulta, terminos: lugar, contar: conteo(0, 7) }))).duros.categorias).toEqual([]);
  });

  it("sin la categoría candidata (o con Jev dudoso) ni se cuenta", async () => {
    const contar = conteo(0, 7);
    await combinar(base({ ...consulta, diccionario: { ...consulta.diccionario, categorias: [] }, jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.99 } }), contar }));
    expect(contar).not.toHaveBeenCalled();
  });

  it("con conteo 0 en la categoría sigue blanda, como antes", async () => {
    const contar = vi.fn(async (f: { categorias: string[]; nombreConTodos?: string[] }) => (f.nombreConTodos || !f.categorias.length ? 0 : 0));
    const p = await combinar(base({ ...consulta, contar }));
    expect(p.duros.categorias).toEqual([]);
  });
});

describe("combinar: una palabra de contexto sola recupera si nombra productos", () => {
  // «patio» solo: contexto (peso 0,3), nada fuerte que recupere. Si hay productos con «patio» en el
  // nombre, recuperan ellos; si no, queda como estaba (la raíz débil).
  const solo = { consulta: "patio", consultaNorm: "patio", terminos: [{ texto: "patio", peso: 0.3 }] };
  const conNombres = (n: number) => vi.fn(async (f: { nombreConTodos?: string[] }) => (f.nombreConTodos ? n : 10));

  it("hay productos con la palabra en el nombre: pasa a peso 1 (recupera y ordena)", async () => {
    const contar = conNombres(12);
    const p = await combinar(base({ ...solo, contar }));
    expect(p.blandos.terminos).toEqual([{ texto: "patio", peso: 1 }]);
    expect(contar).toHaveBeenCalledWith({ categorias: [], atributos: [], nombreConTodos: ["patio"] });
  });

  it("ningún nombre la tiene: sigue como contexto", async () => {
    const p = await combinar(base({ ...solo, contar: conNombres(0) }));
    expect(p.blandos.terminos).toEqual([{ texto: "patio", peso: 0.3 }]);
  });

  it("con Jev: la categoría dura exige además que esos productos existan en ella", async () => {
    const contar = vi.fn(async (f: { categorias: string[]; terminos?: string[]; nombreConTodos?: string[] }) =>
      f.nombreConTodos ? 5 : f.terminos?.includes("patio") ? 0 : 10,
    );
    const p = await combinar(
      base({
        ...solo,
        diccionario: { categorias: ["Reflectores"], atributosExplicitos: [], atributosContexto: [], absorbidos: new Set() },
        jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.99 }, sub: { nombre: "Reflectores", confianza: 0.95 } }),
        contar,
      }),
    );
    expect(contar).toHaveBeenCalledWith({ categorias: ["Reflectores"], atributos: [], terminos: ["patio"] });
    expect(p.duros.categorias).toEqual([]);
  });

  it("sólo si la palabra está sola: «luz para el patio» y «iluminar un cartel de noche» no cambian", async () => {
    const contar = conNombres(12);
    const luzPatio = await combinar(
      base({ consulta: "luz para el patio", terminos: [{ texto: "luz", peso: 0.3 }, { texto: "patio", peso: 0.3 }], contar }),
    );
    expect(luzPatio.blandos.terminos.every((t) => t.peso === 0.3)).toBe(true);
    const cartel = await combinar(
      base({ consulta: "iluminar un cartel de noche", terminos: [{ texto: "iluminar", peso: 0.3 }, { texto: "cartel", peso: 0.3 }, { texto: "noche", peso: 0.3 }], contar }),
    );
    expect(cartel.blandos.terminos.every((t) => t.peso === 0.3)).toBe(true);
    expect(contar).not.toHaveBeenCalledWith(expect.objectContaining({ nombreConTodos: expect.anything() }));
  });

  it("una palabra significativa o una medida sola no entra en esta regla", async () => {
    const contar = conNombres(12);
    await combinar(base({ terminos: [{ texto: "reflector", peso: 1 }], contar }));
    await combinar(base({ terminos: [{ texto: "20", peso: 0.4 }], contar }));
    expect(contar).not.toHaveBeenCalledWith(expect.objectContaining({ nombreConTodos: expect.anything() }));
  });
});

describe("combinar: atributos e intención", () => {
  it("explícito con conteo ≥ 3 es duro; con menos, blando", async () => {
    const dic = { categorias: [], atributosExplicitos: ["tono-calido", "zocalo-e27"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(base({ diccionario: dic, conteoAtributos: { "tono-calido": 3, "zocalo-e27": 2 } }));
    expect(p.duros.atributos).toEqual(["tono-calido"]);
    expect(p.blandos.atributos).toEqual([{ id: "zocalo-e27", peso: 0.9 }]);
  });

  it("un atributo duro que vacía lo que encuentran los términos pasa a blando: el plan no lo lleva como duro", async () => {
    // «panel para exterior»: hay paneles y hay exteriores, pero ningún panel exterior.
    const contar = vi.fn(async ({ atributos }: { atributos: string[] }) => (atributos.includes("apto-exterior") ? 0 : 10));
    const dic = { categorias: [], atributosExplicitos: ["apto-exterior"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(
      base({
        consulta: "panel para exterior",
        consultaNorm: "panel para exterior",
        diccionario: dic,
        terminos: [{ texto: "panel", peso: 1 }, { texto: "exterior", peso: 0.3 }],
        conteoAtributos: { "apto-exterior": 50 },
        contar,
      }),
    );
    expect(p.duros.atributos).toEqual([]);
    expect(p.blandos.atributos).toEqual([{ id: "apto-exterior", peso: 0.9 }]);
    // Cuenta con los términos que recuperan (no con el contexto), con y sin el atributo.
    expect(contar).toHaveBeenCalledWith({ categorias: [], atributos: ["apto-exterior"], terminos: ["panel"] });
    expect(contar).toHaveBeenCalledWith({ categorias: [], atributos: [], terminos: ["panel"] });
  });

  it("si los términos solos tampoco encuentran nada (un error de tipeo), el atributo sigue duro: «reflecotr led exterior»", async () => {
    const contar = vi.fn(async ({ terminos }: { terminos?: string[] }) => (terminos?.length ? 0 : 10));
    const dic = { categorias: [], atributosExplicitos: ["apto-exterior"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(base({ diccionario: dic, terminos: [{ texto: "reflecotr", peso: 1 }], conteoAtributos: { "apto-exterior": 50 }, contar }));
    expect(p.duros.atributos).toEqual(["apto-exterior"]);
    expect(p.blandos.atributos).toEqual([]);
  });

  it("sin términos que recuperen (sólo el atributo, «ip65») no se cuenta ni se degrada", async () => {
    const contar = vi.fn(async () => 0);
    const dic = { categorias: [], atributosExplicitos: ["apto-exterior"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(base({ diccionario: dic, terminos: [{ texto: "ip65", peso: 0.4 }], conteoAtributos: { "apto-exterior": 50 }, contar }));
    expect(p.duros.atributos).toEqual(["apto-exterior"]);
    expect(contar).not.toHaveBeenCalled();
  });

  it("con resultados el atributo duro sigue duro; sin duros no se cuenta de más", async () => {
    const contar = vi.fn(async () => 10);
    const dic = { categorias: [], atributosExplicitos: ["tono-calido"], atributosContexto: [], absorbidos: new Set<string>() };
    const duro = await combinar(base({ diccionario: dic, conteoAtributos: { "tono-calido": 50 }, contar }));
    expect(duro.duros.atributos).toEqual(["tono-calido"]);
    expect(duro.blandos.atributos).toEqual([]);

    const contarNada = vi.fn(async () => 0);
    const blando = await combinar(base({ diccionario: dic, conteoAtributos: { "tono-calido": 2 }, contar: contarNada }));
    expect(blando.duros.atributos).toEqual([]);
    expect(contarNada).not.toHaveBeenCalled();
  });

  it("con categoría dura (ya contada con los atributos) no se vuelve a contar ni se degrada", async () => {
    const contar = vi.fn(async () => 10);
    const dic = { categorias: ["Reflectores"], atributosExplicitos: ["tono-calido"], atributosContexto: [], absorbidos: new Set<string>() };
    const p = await combinar(
      base({
        diccionario: dic,
        conteoAtributos: { "tono-calido": 50 },
        contar,
        jev: jev({ raiz: { nombre: "ILUMINACION", confianza: 0.99 }, sub: { nombre: "Reflectores", confianza: 0.95 } }),
      }),
    );
    expect(p.duros).toEqual({ categorias: ["Reflectores"], atributos: ["tono-calido"] });
    expect(contar).toHaveBeenCalledTimes(1);
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
