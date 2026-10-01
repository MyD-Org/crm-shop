import { describe, expect, it } from "vitest";
import { leerEstado } from "../catalogo-url";
import { chipsSugeridos, hrefInterpretada, hrefTalCual } from "./url";

describe("hrefInterpretada", () => {
  it("aplica categorías y atributos, deja el residual y la consulta original en ia", () => {
    const estado = leerEstado({ q: "Reflector LED 50W cálido", stock: "todos" });
    const href = hrefInterpretada(estado, {
      consulta: "Reflector LED 50W cálido",
      aplicar: { categorias: ["Reflectores"], atributos: ["tono-calido"], q: "50w" },
    });
    expect(href).toBe(
      "/catalogo?q=50w&categoria=Reflectores&atr=tono-calido&stock=todos&ia=Reflector+LED+50W+c%C3%A1lido",
    );
  });

  it("sin residual quita la búsqueda (y el orden por relevancia)", () => {
    const estado = leerEstado({ q: "luz para el patio" });
    const href = hrefInterpretada(estado, {
      consulta: "luz para el patio",
      aplicar: { categorias: [], atributos: ["apto-exterior"] },
    });
    expect(href).toBe("/catalogo?atr=apto-exterior&ia=luz+para+el+patio");
    // La página a la que llega no vuelve a interpretar: trae ia.
    expect(leerEstado({ atr: "apto-exterior", ia: "luz para el patio" }).ia).toBe("luz para el patio");
  });

  it("descarta atributos inválidos (los valida catalogo-url)", () => {
    const href = hrefInterpretada(leerEstado({ q: "x y z" }), {
      consulta: "x y z",
      aplicar: { categorias: [], atributos: ["tono-fucsia"] },
    });
    expect(href).toBe("/catalogo?ia=x+y+z");
  });
});

describe("hrefTalCual", () => {
  it("vuelve a la consulta original sin los filtros interpretados, con ia=0", () => {
    const estado = leerEstado({ q: "50w", categoria: "Reflectores", atr: "tono-calido", marca: "GENROD", ia: "reflector 50w calido" });
    expect(hrefTalCual(estado, "reflector 50w calido")).toBe("/catalogo?q=reflector+50w+calido&marca=GENROD&ia=0");
  });
});

describe("chipsSugeridos", () => {
  const estado = leerEstado({ q: "luz para el patio grande", atr: "tono-calido" });

  it("suma el filtro conservando la búsqueda; sin repetidos ni los ya puestos", () => {
    const chips = chipsSugeridos(estado, [
      { categorias: ["ILUMINACION"], atributos: ["tono-calido", "apto-exterior"] },
      { categorias: ["ILUMINACION", "Reflectores"], atributos: [] },
    ]);
    expect(chips.map((c) => c.etiqueta)).toEqual(["Iluminación", "Apto exterior", "Reflectores"]);
    expect(chips[1].href).toBe("/catalogo?q=luz+para+el+patio+grande&atr=tono-calido&atr=apto-exterior");
  });

  it("modo reemplazar (sin resultados): quita la búsqueda y reemplaza el atributo de su grupo", () => {
    const sinNada = leerEstado({ q: "50w", categoria: "Apliques", atr: ["tono-calido", "zocalo-e27"], ia: "aplique calido e27 50w" });
    const [reflectores, frio] = chipsSugeridos(sinNada, [{ categorias: ["Reflectores"], atributos: ["tono-frio"] }], "reemplazar");
    expect(reflectores.href).toBe("/catalogo?categoria=Reflectores&atr=tono-calido&atr=zocalo-e27");
    expect(frio.href).toBe("/catalogo?categoria=Apliques&atr=tono-frio&atr=zocalo-e27");
  });
});
