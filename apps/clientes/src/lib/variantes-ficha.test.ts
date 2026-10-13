import { describe, expect, it } from "vitest";
import {
  opcionInicial,
  resumirVariantes,
  rutaFichaVariante,
  TEXTOS_VARIANTES,
  textoEtiquetasOpciones,
  vistaCardVariantes,
} from "./variantes-ficha";

describe("resumirVariantes", () => {
  it("un solo precio (o ninguno) no es un modelo con opciones", () => {
    expect(resumirVariantes([])).toBeUndefined();
    expect(resumirVariantes([1000])).toBeUndefined();
  });

  it("tres variantes con el mismo precio: la cantidad, sin 'Desde'", () => {
    expect(resumirVariantes([1000, 1000, 1000])).toEqual({ cantidad: 3 });
  });

  it("el redondeo de centavos no cuenta como diferencia", () => {
    expect(resumirVariantes([1000, 1000.004])).toEqual({ cantidad: 2 });
  });

  it("un grupo manual con un suelto de otro precio: 'Desde' el más bajo", () => {
    expect(resumirVariantes([100, 100, 180])).toEqual({ cantidad: 3, desde: 100 });
    expect(resumirVariantes([180, 100, 100])).toEqual({ cantidad: 3, desde: 100 });
  });
});

describe("vistaCardVariantes", () => {
  const base = { price: 100, precioFinal: 121 };

  it("producto suelto (o flag apagado): la card de siempre", () => {
    expect(vistaCardVariantes(base)).toEqual({ precio: 121, multiple: false, esDesde: false });
    expect(vistaCardVariantes({ price: 100 })).toEqual({ precio: 100, multiple: false, esDesde: false });
  });

  it("modelo con precios iguales: precio de la representante y cantidad de opciones, sin agregar", () => {
    const v = vistaCardVariantes({ ...base, variantes: { cantidad: 3 } });
    expect(v).toEqual({ precio: 121, nota: "3 opciones", multiple: true, esDesde: false });
  });

  it("modelo con precios distintos: 'Desde' el menor", () => {
    const v = vistaCardVariantes({ ...base, variantes: { cantidad: 3, desde: 100 } });
    expect(v.precio).toBe(100);
    expect(v.nota).toBe("Desde este precio · 3 opciones");
    expect(v.esDesde).toBe(true);
    expect(v.multiple).toBe(true);
  });

  it("con precio de lista privada de la cuenta no se ofrece 'Desde'", () => {
    const v = vistaCardVariantes({ ...base, precioCuenta: "privado", variantes: { cantidad: 3, desde: 100 } });
    expect(v.precio).toBe(121);
    expect(v.esDesde).toBe(false);
    expect(v.nota).toBe("3 opciones");
  });
});

describe("rutaFichaVariante y textos", () => {
  it("codifica el id sintético de la cuenta secundaria", () => {
    expect(rutaFichaVariante("4521")).toBe("/producto/4521");
    expect(rutaFichaVariante("mdp:12")).toBe("/producto/mdp%3A12");
  });

  it("los textos van en usted / neutros, sin voseo", () => {
    const todos = [
      TEXTOS_VARIANTES.etiquetaSelector,
      TEXTOS_VARIANTES.sinStock,
      TEXTOS_VARIANTES.noDisponible,
      TEXTOS_VARIANTES.opciones(2),
      TEXTOS_VARIANTES.desdeEsteMonto,
    ].join(" ");
    expect(todos).not.toMatch(/\b(elegí|elegi|tenés|vos|tu|tus)\b/i);
  });
});

describe("etiquetas de las opciones en la card", () => {
  it("resumirVariantes conserva las primeras 3 etiquetas, en el orden recibido", () => {
    expect(resumirVariantes([1, 1, 1, 1], ["A", "B", "C", "D"])).toEqual({ cantidad: 4, etiquetas: ["A", "B", "C"] });
    expect(resumirVariantes([1, 2], ["A", "B"])).toEqual({ cantidad: 2, desde: 1, etiquetas: ["A", "B"] });
  });

  it("textoEtiquetasOpciones: lista con ' · ' y '+N' si hay más opciones que etiquetas", () => {
    expect(textoEtiquetasOpciones({ cantidad: 2, etiquetas: ["Blanco frío", "Blanco cálido"] })).toBe("Blanco frío · Blanco cálido");
    expect(textoEtiquetasOpciones({ cantidad: 6, etiquetas: ["A", "B", "C"] })).toBe("A · B · C +3");
    expect(textoEtiquetasOpciones({ cantidad: 3 })).toBeUndefined();
  });

  it("la nota de la card nombra las opciones; sin etiquetas, la cantidad", () => {
    const base = { precioFinal: 121, price: 100 };
    expect(vistaCardVariantes({ ...base, variantes: { cantidad: 2, etiquetas: ["A", "B"] } }).nota).toBe("A · B");
    expect(vistaCardVariantes({ ...base, variantes: { cantidad: 2, desde: 80, etiquetas: ["A", "B"] } }).nota).toBe(
      "Desde este precio · A · B",
    );
    expect(vistaCardVariantes({ ...base, variantes: { cantidad: 2 } }).nota).toBe("2 opciones");
  });
});

describe("opcionInicial (panel de la card)", () => {
  const o = (id: string, stock: "in" | "low" | "out") => ({ id, stock });
  it("la de la card si tiene stock", () => {
    expect(opcionInicial([o("1", "out"), o("2", "in"), o("3", "low")], "3")?.id).toBe("3");
  });
  it("si la de la card está agotada, la primera con stock", () => {
    expect(opcionInicial([o("1", "out"), o("2", "in"), o("3", "in")], "1")?.id).toBe("2");
  });
  it("si ninguna tiene stock, la de la card (se ve «Sin stock»)", () => {
    expect(opcionInicial([o("1", "out"), o("2", "out")], "2")?.id).toBe("2");
  });
  it("sin opciones, null", () => {
    expect(opcionInicial([], "1")).toBeNull();
  });
});
