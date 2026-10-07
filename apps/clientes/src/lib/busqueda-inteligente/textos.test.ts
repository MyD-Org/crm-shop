import { describe, expect, it } from "vitest";
import { REGISTRO } from "@/test/registro-usted";
import {
  EJEMPLOS_PLACEHOLDER,
  TEXTOS_FRANJA,
  TEXTOS_GUIA,
  TEXTOS_LOCAL_RECORDADO,
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
    ...valores(TEXTOS_LOCAL_RECORDADO),
    ...EJEMPLOS_PLACEHOLDER.map(placeholderDe),
  ];
}

describe("copy de la búsqueda inteligente", () => {
  it("en usted: sin voseo ni tuteo", () => {
    const malos = todos().filter((t) => REGISTRO.test(t));
    expect(malos).toEqual([]);
  });

  it("el aviso del local recordado nombra el local y dice que lo eligió antes", () => {
    expect(TEXTOS_LOCAL_RECORDADO.aviso("Mar del Plata")).toBe(
      "Mostrando productos con stock en Mar del Plata (lo eligió antes).",
    );
    expect(TEXTOS_LOCAL_RECORDADO.accion).toBe("Ver todos los locales");
  });

  it("los textos con la consulta la citan", () => {
    expect(TEXTOS_FRANJA.texto("luz patio")).toBe("Búsqueda: «luz patio»");
    expect(TEXTOS_SIN_RESULTADOS.sinFiltros("luz patio")).toBe("Buscar «luz patio» sin filtros");
    expect(TEXTOS_SIN_RESULTADOS.titulo("x")).toContain('"x"');
  });
});
