import { describe, expect, it } from "vitest";
import { REGISTRO } from "@/test/registro-usted";
import {
  EJEMPLOS_PLACEHOLDER,
  TEXTOS_FRANJA,
  TEXTOS_GUIA,
  TEXTOS_SIN_RESULTADOS,
  placeholderDe,
} from "./textos";

/** Todos los textos, con las funciones evaluadas con un ejemplo. */
function todos(): string[] {
  const valores = (o: object): string[] =>
    Object.values(o).flatMap((v) =>
      typeof v === "function" ? [String(v("ejemplo"))] : typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" ? [x] : valores(x))) : valores(v),
    );
  return [
    ...valores(TEXTOS_FRANJA),
    ...valores(TEXTOS_SIN_RESULTADOS),
    ...valores(TEXTOS_GUIA),
    ...EJEMPLOS_PLACEHOLDER.map(placeholderDe),
  ];
}

describe("copy de la búsqueda inteligente", () => {
  it("en usted: sin voseo ni tuteo", () => {
    const malos = todos().filter((t) => REGISTRO.test(t));
    expect(malos).toEqual([]);
  });

  it("los textos con la consulta la citan", () => {
    expect(TEXTOS_FRANJA.talCual("luz patio")).toBe("Ver resultados de «luz patio» tal cual");
    expect(TEXTOS_SIN_RESULTADOS.titulo("x")).toContain('"x"');
  });
});
