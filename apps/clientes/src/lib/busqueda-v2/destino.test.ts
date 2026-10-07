import { describe, expect, it } from "vitest";
import { PESO_DEDUCIDO, criterioDe, estadoConPlan, hrefConPlan } from "./destino";
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

describe("criterioDe: lo deducido como duro ordena y recupera, nunca filtra", () => {
  it("la categoría dura entra a las blandas con el peso más alto y viaja como deducida", () => {
    const p = {
      ...plan({ categorias: ["Dicroicas"] }),
      blandos: { categorias: [{ nombre: "Lámparas", peso: 0.5 }], atributos: [], terminos: [] },
    };
    const c = criterioDe(p, { categorias: [], atributos: [] });
    expect(c.blandos.categorias).toEqual([
      { nombre: "Dicroicas", peso: PESO_DEDUCIDO },
      { nombre: "Lámparas", peso: 0.5 },
    ]);
    // Además acota la recuperación (sin chip ni filtro): ver `acotarPorDeducidas`.
    expect(c.deducidas).toEqual(["Dicroicas"]);
    expect(criterioDe(plan({}), { categorias: [], atributos: [] })).not.toHaveProperty("deducidas");
  });

  it("un atributo duro del diccionario entra a lo blando; si la persona ya lo eligió, manda su filtro", () => {
    const p = plan({ atributos: ["zocalo-e27"] }, [{ id: "tono-calido", peso: 0.9 }]);
    expect(criterioDe(p, { categorias: [], atributos: [] }).blandos.atributos).toEqual([
      { id: "zocalo-e27", peso: PESO_DEDUCIDO },
      { id: "tono-calido", peso: 0.9 },
    ]);
    expect(criterioDe(p, { categorias: [], atributos: ["zocalo-e27"] }).blandos.atributos).toEqual([{ id: "tono-calido", peso: 0.9 }]);
  });

  it("la categoría que la persona tildó no se repite como blanda", () => {
    const c = criterioDe(plan({ categorias: ["Dicroicas"] }), { categorias: ["Dicroicas"], atributos: [] });
    expect(c.blandos.categorias).toEqual([]);
  });

  it("una medida dura que también es blanda no se duplica (queda con el mayor peso)", () => {
    const p = plan({ atributos: ["polos:2"] }, [{ id: "polos:2", peso: 1 }]);
    expect(criterioDe(p, { categorias: [], atributos: [] }).blandos.atributos).toEqual([{ id: "polos:2", peso: 1 }]);
  });
});

describe("estadoConPlan: la búsqueda no agrega filtros que la persona no eligió", () => {
  it("ni la categoría ni los atributos ni las medidas duras del plan van a la URL; sí los filtros vigentes", () => {
    const e = estadoConPlan(
      { ...base, atributos: ["zocalo-e27"], marcas: ["X"] },
      plan({ categorias: ["Dicroicas"], atributos: ["polos:2", "corriente_a:20"] }),
    );
    expect(e.categorias).toEqual([]);
    expect(e.atributos).toEqual(["zocalo-e27"]);
    expect(e.marcas).toEqual(["X"]);
    expect(e.orden).toBe("relevancia");
  });

  it("un id inválido de los filtros vigentes se descarta (R6.10)", () => {
    const e = estadoConPlan({ ...base, atributos: ["polos:9", "corriente_a:20' OR 1=1--", "polos:2"] }, plan({}));
    expect(e.atributos).toEqual(["polos:2"]);
  });

  it("la URL lleva sólo la consulta e ia=1 (sin stock: el default de la tienda)", () => {
    const href = hrefConPlan(base, plan({ categorias: ["Dicroicas"], atributos: ["polos:2", "corriente_a:20"] }));
    expect(href).toBe("/catalogo?q=termica+2x20&ia=1");
    const sp = new URLSearchParams(href.split("?")[1]);
    const leido = leerEstado({ q: sp.get("q") ?? undefined, atr: sp.getAll("atr"), ia: sp.get("ia") ?? undefined });
    expect(leido.atributos).toEqual([]);
    expect(leido.categorias).toEqual([]);
    expect(leido.soloStock).toBe(true);
  });
});
