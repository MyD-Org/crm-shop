import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TextoConEnfasis } from "./TextoConEnfasis";

describe("TextoConEnfasis", () => {
  it("el monto va en <strong>", () => {
    expect(renderToStaticMarkup(<TextoConEnfasis texto="Sume $ 30.000 más y pague." enfasis="$ 30.000" />)).toBe(
      "Sume <strong>$ 30.000</strong> más y pague.",
    );
  });
  it("sin énfasis o ausente del texto: tal cual", () => {
    expect(renderToStaticMarkup(<TextoConEnfasis texto="¡Listo!" />)).toBe("¡Listo!");
    expect(renderToStaticMarkup(<TextoConEnfasis texto="Hola" enfasis="x" />)).toBe("Hola");
  });
});
