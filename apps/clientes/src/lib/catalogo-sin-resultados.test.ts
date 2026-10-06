import { describe, expect, it } from "vitest";
import type { EstadoCatalogo } from "./catalogo-url";
import { sinResultadosPorLocal } from "./catalogo-sin-resultados";

const base: EstadoCatalogo = {
  query: undefined,
  categorias: [],
  marcas: [],
  atributos: [],
  orden: "nombre",
  pagina: 1,
  soloStock: true,
  vista: "grilla",
};
const locales = [
  { slug: "mar-del-plata", nombre: "Mar del Plata" },
  { slug: "igz", nombre: "Iguazú" },
];

describe("sinResultadosPorLocal", () => {
  it("sin filtro de local no aplica", () => {
    expect(sinResultadosPorLocal(base, locales, "luz")).toBeNull();
  });

  it("con local y consulta, dice el local por su nombre y la consulta", () => {
    const r = sinResultadosPorLocal({ ...base, retiroEn: "mar-del-plata" }, locales, "luz");
    expect(r).toEqual({
      titulo: "No hay productos con stock en Mar del Plata para «luz»",
      descripcion: "Puede ver los productos de todos los locales.",
      accion: "Ver en todos los locales",
    });
  });

  it("navegando sin consulta, el título no la menciona", () => {
    const r = sinResultadosPorLocal({ ...base, retiroEn: "igz" }, locales, undefined);
    expect(r?.titulo).toBe("No hay productos con stock en Iguazú");
    expect(sinResultadosPorLocal({ ...base, retiroEn: "igz" }, locales, "  ")?.titulo).toBe(
      "No hay productos con stock en Iguazú",
    );
  });

  it("un local desconocido cae al slug", () => {
    const r = sinResultadosPorLocal({ ...base, retiroEn: "otro" }, locales, undefined);
    expect(r?.titulo).toBe("No hay productos con stock en otro");
  });
});
