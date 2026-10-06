import { describe, expect, it } from "vitest";
import { leerEstado } from "../catalogo-url";
import { chipsSugeridos, hrefTalCual } from "./url";

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
