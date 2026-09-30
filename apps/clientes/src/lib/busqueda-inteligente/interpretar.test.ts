import { describe, expect, it, vi } from "vitest";
import { MINIMO_PARA_SUB_MS, PRESUPUESTO_JEV_MS, interpretarCon, type Dependencias } from "./interpretar";
import type { PreguntaChoice, Respuestas } from "./jev";
import type { NodoArbol } from "./tipos";

const n = (id: string, nombre: string, parentId: string | null = null, orden = 0): NodoArbol => ({ id, parentId, nombre, orden });
const ARBOL: NodoArbol[] = [
  n("r1", "ILUMINACION", null, 1),
  n("r2", "MATERIALES ELECTRICOS", null, 2),
  n("c1", "Reflectores", "r1", 1),
  n("c2", "Apliques", "r1", 2),
  n("c3", "Cables", "r2", 1),
  n("c4", "Térmicas", "r2", 2),
];

/** Jev simulado: responde por id de pregunta con la opción y la confianza dadas. */
function jevFalso(respuestas: Record<string, [string, number]>) {
  return vi.fn(async (_c: string, preguntas: Record<string, PreguntaChoice>): Promise<Respuestas> => {
    const r: Respuestas = {};
    for (const id of Object.keys(preguntas)) {
      if (respuestas[id]) r[id] = { choice: respuestas[id][0], confidence: respuestas[id][1] };
    }
    return r;
  });
}

function deps(parcial: Partial<Dependencias> = {}): Dependencias {
  return {
    arbol: ARBOL,
    jev: null,
    leerCache: vi.fn(async () => null),
    guardarCache: vi.fn(async () => {}),
    ...parcial,
  };
}

describe("interpretarCon", () => {
  it("un código, una consulta vacía o un dato personal no se interpretan ni se guardan", async () => {
    const d = deps();
    expect(await interpretarCon("DL-18W", d)).toBeNull();
    expect(await interpretarCon("  ", d)).toBeNull();
    expect(await interpretarCon("persona@cliente.example", d)).toBeNull();
    expect(d.leerCache).not.toHaveBeenCalled();
    expect(d.guardarCache).not.toHaveBeenCalled();
  });

  it("determinista: aplica categoría y atributos, deja el residual con dígitos y no llama a Jev", async () => {
    const jev = jevFalso({});
    const d = deps({ jev });
    const r = await interpretarCon("Reflector LED 50W cálido", d);
    expect(r).toEqual({
      consulta: "Reflector LED 50W cálido",
      aplicar: { categorias: ["Reflectores"], atributos: ["tono-calido"], q: "50w" },
      sugerir: { categorias: [], atributos: [] },
      fuente: "deterministico",
    });
    expect(jev).not.toHaveBeenCalled();
    expect(d.guardarCache).toHaveBeenCalledWith("reflector led 50w calido", expect.any(String), {
      resultado: { aplicar: r!.aplicar, sugerir: r!.sugerir },
      fuente: "deterministico",
    });
  });

  it("caché: devuelve lo guardado con fuente cache y no vuelve a calcular", async () => {
    const guardado = { aplicar: { categorias: ["Apliques"], atributos: [] }, sugerir: { categorias: [], atributos: [] } };
    const jev = jevFalso({});
    const d = deps({ jev, leerCache: vi.fn(async () => ({ resultado: guardado, fuente: "jev" as const })) });
    expect(await interpretarCon("luz para la pared", d)).toEqual({ consulta: "luz para la pared", ...guardado, fuente: "cache" });
    expect(jev).not.toHaveBeenCalled();
    expect(d.guardarCache).not.toHaveBeenCalled();
  });

  it("Jev: raíz y sub seguras ⇒ aplica la sub; tono seguro ⇒ aplica; ambiente dudoso ⇒ sugiere", async () => {
    const jev = jevFalso({
      raiz: ["iluminacion", 0.96],
      sub: ["apliques", 0.93],
      tono: ["frio", 0.92],
      ambiente: ["exterior", 0.8],
    });
    const r = await interpretarCon("luz blanca para la pared de afuera", deps({ jev }));
    expect(r).toMatchObject({
      aplicar: { categorias: ["Apliques"], atributos: ["tono-frio"] },
      sugerir: { categorias: [], atributos: ["apto-exterior"] },
      fuente: "jev",
    });
    expect(r!.aplicar.q).toBeUndefined();
    expect(jev).toHaveBeenCalledTimes(2);
    // La primera llamada pregunta raíz, tono y ambiente; la segunda sólo la sub.
    expect(Object.keys(jev.mock.calls[0][1]).sort()).toEqual(["ambiente", "raiz", "tono"]);
    expect(Object.keys(jev.mock.calls[1][1])).toEqual(["sub"]);
  });

  it("Jev: raíz dudosa ⇒ se sugiere, y la sub también; `no_especifica` no suma nada", async () => {
    const jev = jevFalso({ raiz: ["iluminacion", 0.8], sub: ["reflectores", 0.95], tono: ["no_especifica", 0.99] });
    const r = await interpretarCon("algo para iluminar el taller", deps({ jev }));
    expect(r).toMatchObject({
      aplicar: { categorias: [], atributos: [] },
      sugerir: { categorias: ["ILUMINACION", "Reflectores"], atributos: [] },
    });
  });

  it("Jev: raíz con confianza baja ⇒ no pregunta la sub ni suma la raíz", async () => {
    const jev = jevFalso({ raiz: ["iluminacion", 0.5] });
    const r = await interpretarCon("regalo lindo para mama", deps({ jev }));
    expect(jev).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ aplicar: { categorias: [], atributos: [] }, sugerir: { categorias: [], atributos: [] } });
  });

  it("lo determinista manda sobre Jev en el mismo grupo de atributos", async () => {
    const jev = jevFalso({ raiz: ["iluminacion", 0.95], tono: ["frio", 0.99] });
    const r = await interpretarCon("luz calida para el living", deps({ jev }));
    expect(r!.aplicar.atributos).toEqual(["tono-calido"]);
    expect(r!.sugerir.atributos).toEqual([]);
  });

  it("Jev caído ⇒ queda lo determinista y NO se guarda en la caché", async () => {
    const d = deps({ jev: vi.fn(async () => null) });
    const r = await interpretarCon("luz calida para el living", d);
    expect(r).toMatchObject({ aplicar: { categorias: [], atributos: ["tono-calido"] }, fuente: "deterministico" });
    expect(d.guardarCache).not.toHaveBeenCalled();
  });

  it("sin Jev configurado ⇒ lo determinista se guarda igual", async () => {
    const d = deps({ jev: null });
    await interpretarCon("luz calida para el living", d);
    expect(d.guardarCache).toHaveBeenCalledTimes(1);
  });
});

describe("presupuesto total de Jev (2,5 s entre las dos llamadas)", () => {
  it("la primera llamada recibe el presupuesto entero y la segunda sólo lo que queda", async () => {
    let t = 0;
    const jev = vi.fn<NonNullable<Dependencias["jev"]>>(async (_c, preguntas): Promise<Respuestas> => {
      t += 1500;
      return "sub" in preguntas
        ? { sub: { choice: "apliques", confidence: 0.95 } }
        : { raiz: { choice: "iluminacion", confidence: 0.95 } };
    });
    await interpretarCon("luz para la pared del living", deps({ jev, ahora: () => t }));
    expect(jev).toHaveBeenCalledTimes(2);
    expect(jev.mock.calls[0][2]).toBe(PRESUPUESTO_JEV_MS);
    expect(jev.mock.calls[1][2]).toBe(PRESUPUESTO_JEV_MS - 1500);
  });

  it("si no queda presupuesto suficiente, no pregunta la subcategoría (la raíz se aplica igual)", async () => {
    let t = 0;
    const jev = vi.fn(async (): Promise<Respuestas> => {
      t += PRESUPUESTO_JEV_MS - MINIMO_PARA_SUB_MS + 1;
      return { raiz: { choice: "iluminacion", confidence: 0.95 } };
    });
    const r = await interpretarCon("luz para la pared del living", deps({ jev, ahora: () => t }));
    expect(jev).toHaveBeenCalledTimes(1);
    expect(r!.aplicar.categorias).toEqual(["ILUMINACION"]);
  });
});
