import { describe, expect, it } from "vitest";
import {
  HREF_OFERTAS,
  estadoDeBusqueda,
  filtrosDeEstado,
  hrefCanonico,
  hrefCatalogo,
  hrefCon,
  leerEstado,
  type EstadoCatalogo,
} from "./catalogo-url";
import {
  TEXTOS_OFERTAS,
  chipsActivos,
  contarFiltrosActivos,
  indexable,
  limpiarFiltros,
  migas,
  ofertasVacias,
  ordenesPara,
  tituloCatalogo,
} from "./catalogo-vista";

/** «Solo ofertas» (`?ofertas=1`) y el orden «Mayor descuento» en el estado del catálogo. */
describe("Solo ofertas en la URL", () => {
  it("`ofertas=1` lo prende; cualquier otro valor o ausente lo deja apagado (sin la clave)", () => {
    expect(leerEstado({ ofertas: "1" }).soloOfertas).toBe(true);
    expect("soloOfertas" in leerEstado({})).toBe(false);
    expect("soloOfertas" in leerEstado({ ofertas: "si" })).toBe(false);
    expect(estadoDeBusqueda(new URLSearchParams("ofertas=1&orden=descuento"))).toMatchObject({ soloOfertas: true, orden: "descuento" });
  });

  it("HREF_OFERTAS es la URL que arma el catálogo para ese estado (misma canónica de parámetros)", () => {
    const estado = leerEstado({ ofertas: "1", orden: "descuento" });
    expect(hrefCatalogo(estado)).toBe(HREF_OFERTAS);
    expect(HREF_OFERTAS).toBe("/catalogo?ofertas=1&orden=descuento");
  });

  it("se conserva al cambiar otro filtro y se quita con `soloOfertas: undefined`", () => {
    const estado = leerEstado({ ofertas: "1" });
    expect(hrefCon(estado, { marcas: ["KING"] })).toBe("/catalogo?marca=KING&ofertas=1");
    expect(hrefCon(estado, { soloOfertas: undefined })).toBe("/catalogo");
  });

  it("quitarlo (chip o «Limpiar filtros») desde /ofertas vuelve al orden de siempre", () => {
    const desdeOfertas = leerEstado({ ofertas: "1", orden: "descuento" });
    expect(hrefCon(desdeOfertas, { soloOfertas: undefined })).toBe("/catalogo");
    expect(hrefCon(desdeOfertas, limpiarFiltros())).toBe("/catalogo");
    expect(hrefCon({ ...desdeOfertas, query: "panel" }, { soloOfertas: undefined })).toBe("/catalogo?q=panel");
    // Con ofertas, cambiar otro filtro conserva el orden; y quien lo pide explícito, lo tiene.
    expect(hrefCon(desdeOfertas, { marcas: ["KING"] })).toBe("/catalogo?marca=KING&ofertas=1&orden=descuento");
    expect(hrefCon(desdeOfertas, { soloOfertas: undefined, orden: "descuento" })).toBe("/catalogo?orden=descuento");
  });

  it("llega a los filtros de la consulta sólo si está prendido", () => {
    expect(filtrosDeEstado(leerEstado({ ofertas: "1" })).soloOfertas).toBe(true);
    expect("soloOfertas" in filtrosDeEstado(leerEstado({}))).toBe(false);
  });

  it("no es indexable y la canónica es el catálogo", () => {
    const estado = leerEstado({ ofertas: "1" });
    expect(indexable(estado)).toBe(false);
    expect(hrefCanonico(estado)).toBe("/catalogo");
  });
});

describe("Solo ofertas en la vista", () => {
  const ofertas: EstadoCatalogo = leerEstado({ ofertas: "1", orden: "descuento" });

  it("título «Ofertas», miga propia y chip que lo quita", () => {
    expect(tituloCatalogo(ofertas)).toBe("Ofertas");
    expect(migas(ofertas).at(-1)).toEqual({ label: "Ofertas" });
    const [chip] = chipsActivos(ofertas, null);
    expect(chip).toMatchObject({ clave: "ofertas", etiqueta: TEXTOS_OFERTAS.chip, cambios: { soloOfertas: undefined } });
  });

  it("una categoría o una búsqueda le ganan al título", () => {
    expect(tituloCatalogo({ ...ofertas, categorias: ["ILUMINACION"] })).not.toBe("Ofertas");
    expect(tituloCatalogo({ ...ofertas, query: "panel" })).toBe('Resultados para "panel"');
  });

  it("cuenta como filtro y «Limpiar filtros» lo apaga", () => {
    expect(contarFiltrosActivos(ofertas)).toBe(1);
    expect(limpiarFiltros()).toHaveProperty("soloOfertas", undefined);
  });

  it("«Mayor descuento» se ofrece sólo mirando ofertas (o si ya es el orden)", () => {
    const sin = leerEstado({});
    expect(ordenesPara(sin).some((o) => o.value === "descuento")).toBe(false);
    expect(ordenesPara(ofertas).some((o) => o.value === "descuento")).toBe(true);
    expect(ordenesPara({ ...sin, orden: "descuento" }).some((o) => o.value === "descuento")).toBe(true);
  });

  it("vacío propio sólo sin otros filtros ni búsqueda", () => {
    expect(ofertasVacias(ofertas)).toBe(true);
    expect(ofertasVacias({ ...ofertas, marcas: ["KING"] })).toBe(false);
    expect(ofertasVacias({ ...ofertas, query: "panel" })).toBe(false);
    expect(ofertasVacias(leerEstado({}))).toBe(false);
  });

  it("bajada en usted, con singular", () => {
    expect(TEXTOS_OFERTAS.bajada(9)).toBe("9 productos con precio especial");
    expect(TEXTOS_OFERTAS.bajada(1)).toBe("1 producto con precio especial");
  });
});
