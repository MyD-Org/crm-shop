import { describe, expect, it } from "vitest";
import { criterioDe, estadoConPlan, hrefConPlan } from "./destino";
import { leerEstado, type EstadoCatalogo } from "../catalogo-url";
import { planVacio, type PlanBusqueda } from "./plan";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  atributos: [],
  caracteristicas: [],
  orden: "nombre",
  pagina: 1,
  soloStock: true,
  vista: "grilla",
};

const plan = (duros: Partial<PlanBusqueda["duros"]>, atributosBlandos: { id: string; peso: number }[] = []): PlanBusqueda => ({
  ...planVacio("termica 2x20"),
  duros: { categorias: [], atributos: [], ...duros },
  blandos: { categorias: [], atributos: atributosBlandos, terminos: [] },
});

describe("criterioDe: lo blando que ordena y recupera", () => {
  it("un atributo del diccionario que ya es filtro (URL) no suma dos veces", () => {
    const p = plan({}, [{ id: "zocalo-e27", peso: 0.9 }, { id: "tono-calido", peso: 0.9 }]);
    const c = criterioDe(p, { categorias: [], atributos: ["zocalo-e27"] });
    expect(c.blandos.atributos.map((a) => a.id)).toEqual(["tono-calido"]);
  });

  it("una medida dura se deja en blandos aunque ya sea filtro: el filtro es 'sin contradicción' y el boost sube a los que SÍ tienen el dato", () => {
    const p = plan({ atributos: ["corriente_a:20"] }, [{ id: "corriente_a:20", peso: 1 }, { id: "tono-calido", peso: 0.9 }]);
    const c = criterioDe(p, { categorias: [], atributos: ["corriente_a:20", "tono-calido"] });
    expect(c.blandos.atributos.map((a) => a.id)).toEqual(["corriente_a:20"]);
  });

  it("sin la medida en el estado (el usuario quitó el chip) el boost permanece: la preferencia sigue en el plan", () => {
    const p = plan({ atributos: ["polos:2"] }, [{ id: "polos:2", peso: 1 }]);
    const c = criterioDe(p, { categorias: [], atributos: [] });
    expect(c.blandos.atributos.map((a) => a.id)).toEqual(["polos:2"]);
  });
});

describe("criterioDe: las categorías del plan (duras y blandas) viajan para desempatar", () => {
  it("une duras y blandas sin repetir; sin categorías, no agrega el campo", () => {
    const p = { ...plan({ categorias: ["Luminarias exteriores"] }), blandos: { categorias: [{ nombre: "Reflectores", peso: 0.8 }, { nombre: "Luminarias exteriores", peso: 0.5 }], atributos: [], terminos: [] } };
    expect(criterioDe(p, { categorias: [], atributos: [] }).categoriasDelPlan).toEqual(["Luminarias exteriores", "Reflectores"]);
    expect(criterioDe(plan({}), { categorias: [], atributos: [] })).not.toHaveProperty("categoriasDelPlan");
  });
});

describe("estadoConPlan: los duros viajan por la URL y los inválidos se descartan", () => {
  it("suma las medidas duras a los filtros vigentes, validadas y en orden canónico", () => {
    const e = estadoConPlan({ ...base, atributos: ["zocalo-e27"] }, plan({ atributos: ["polos:2", "corriente_a:20"] }));
    expect(e.atributos).toEqual(["zocalo-e27", "corriente_a:20", "polos:2"]);
    expect(e.orden).toBe("relevancia");
  });

  it("un id inválido de un plan cacheado se descarta (R6.10)", () => {
    const e = estadoConPlan(base, plan({ atributos: ["polos:9", "corriente_a:20' OR 1=1--", "polos:2"] }));
    expect(e.atributos).toEqual(["polos:2"]);
  });

  it("round-trip por la URL", () => {
    const href = hrefConPlan(base, plan({ atributos: ["polos:2", "corriente_a:20"] }));
    expect(href).toBe("/catalogo?q=termica+2x20&atr=corriente_a%3A20&atr=polos%3A2&ia=1");
    const sp = new URLSearchParams(href.split("?")[1]);
    const leido = leerEstado({ q: sp.get("q") ?? undefined, atr: sp.getAll("atr"), ia: sp.get("ia") ?? undefined });
    expect(leido.atributos).toEqual(["corriente_a:20", "polos:2"]);
  });
});
