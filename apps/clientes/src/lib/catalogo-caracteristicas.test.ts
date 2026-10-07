import { describe, expect, it } from "vitest";
import fixture from "../db/__fixtures__/atributos-claves.json";
import {
  atributosParaAgente,
  caracteristicasDe,
  CLAVES_ESTRUCTURADAS,
  ETIQUETA,
  etiquetasTecnicas,
  formatoValor,
  leerAtributosEstructurados,
  TIPO,
  type AtributosEstructurados,
  type ClaveEstructurada,
} from "./catalogo-caracteristicas";

const n = (v: number) => ({ n: v, t: null });
const t = (v: string) => ({ n: null, t: v });

/** Una muestra válida por clave: ninguna clave puede quedar sin formato. */
const MUESTRA: Record<ClaveEstructurada, { n: number | null; t: string | null }> = {
  potencia_w: n(12),
  temperatura_k: n(3000),
  tono: t("calido"),
  ip: n(65),
  flujo_lm: n(900),
  tension_v: n(220),
  zocalo: t("e27"),
  corriente_a: n(25),
  polos: n(2),
  seccion_mm2: n(2.5),
  medidas_mm: t("300x1200"),
  color: t("blanco"),
  poder_corte_ka: n(6),
  curva: t("c"),
  sensibilidad_ma: n(30),
  largo_m: n(100),
  montaje: t("embutir"),
  angulo_grados: n(60),
  leds_m: n(120),
  potencia_w_m: n(14.4),
  leds_rollo: n(300),
  diametro_mm: n(25),
  ancho_mm: n(150),
  dimerizable: t("si"),
  modulos: n(12),
};

describe("paridad con el contrato de claves (fixture compartido con el CRM)", () => {
  it("CLAVES_ESTRUCTURADAS = fixture.claves, en el mismo orden", () => {
    expect([...CLAVES_ESTRUCTURADAS]).toEqual(fixture.claves);
    expect(CLAVES_ESTRUCTURADAS).toHaveLength(25);
  });

  it("ETIQUETA y TIPO cubren exactamente las claves del fixture, con el tipo del fixture", () => {
    expect(Object.keys(ETIQUETA).sort()).toEqual([...fixture.claves].sort());
    expect(Object.keys(TIPO).sort()).toEqual([...fixture.claves].sort());
    expect(TIPO).toEqual(fixture.tipos);
  });

  it("formatoValor con una muestra válida de cada clave devuelve texto", () => {
    for (const c of CLAVES_ESTRUCTURADAS) {
      const v = formatoValor(c, MUESTRA[c]);
      expect(v, c).toEqual(expect.any(String));
      expect(v, c).not.toBe("");
    }
  });
});

describe("leerAtributosEstructurados", () => {
  it("valida el jsonb de la consulta: claves conocidas, numeric como string, vacíos afuera", () => {
    expect(
      leerAtributosEstructurados({
        potencia_w: { n: "50", t: null },
        tono: { n: null, t: "calido" },
        inventada: { n: null, t: "rojo" },
        ip: { n: null, t: "" },
      }),
    ).toEqual({ potencia_w: { n: 50, t: null }, tono: { n: null, t: "calido" } });
  });

  it("color es una clave válida", () => {
    expect(leerAtributosEstructurados({ color: { n: null, t: "rojo" } })).toEqual({ color: { n: null, t: "rojo" } });
  });

  it("null, arrays o sin nada útil ⇒ undefined", () => {
    expect(leerAtributosEstructurados(null)).toBeUndefined();
    expect(leerAtributosEstructurados([])).toBeUndefined();
    expect(leerAtributosEstructurados({ ip: { n: null, t: null } })).toBeUndefined();
  });
});

describe("formato", () => {
  it("valores legibles", () => {
    expect(formatoValor("potencia_w", { n: 4.5, t: null })).toBe("4,5 W");
    expect(formatoValor("temperatura_k", { n: 3000, t: null })).toBe("3000 K");
    expect(formatoValor("ip", { n: 65, t: null })).toBe("IP65");
    expect(formatoValor("tension_v", { n: 220, t: "85-265" })).toBe("85–265 V");
    expect(formatoValor("tension_v", { n: 12, t: null })).toBe("12 V");
    expect(formatoValor("tono", { n: null, t: "calido" })).toBe("Cálida");
    expect(formatoValor("zocalo", { n: null, t: "gu10" })).toBe("GU10");
    expect(formatoValor("potencia_w", undefined)).toBeNull();
  });

  it("tabla Características en orden fijo", () => {
    expect(
      caracteristicasDe({
        zocalo: { n: null, t: "e27" },
        potencia_w: { n: 9, t: null },
        tono: { n: null, t: "frio" },
      }),
    ).toEqual([
      { etiqueta: "Potencia", valor: "9 W" },
      { etiqueta: "Tipo de luz", valor: "Fría" },
      { etiqueta: "Base / zócalo", valor: "E27" },
    ]);
    expect(caracteristicasDe(undefined)).toEqual([]);
  });

  it("compacto para el agente y etiquetas técnicas para la card", () => {
    const a = { potencia_w: { n: 12, t: null }, tension_v: { n: 220, t: "85-265" }, tono: { n: null, t: "calido" } };
    expect(atributosParaAgente(a)).toEqual({ potencia_w: 12, tono: "calido", tension_v: "85-265" });
    expect(atributosParaAgente(undefined)).toBeUndefined();
    expect(etiquetasTecnicas(a)).toEqual(["12 W", "85–265 V"]);
  });
});

describe("formato de las claves ampliadas (es-AR)", () => {
  it("corriente, sección, poder de corte, sensibilidad, largo y ángulo llevan unidad", () => {
    expect(formatoValor("corriente_a", n(25))).toBe("25 A");
    expect(formatoValor("seccion_mm2", n(2.5))).toBe("2,5 mm²");
    expect(formatoValor("seccion_mm2", n(0.75))).toBe("0,75 mm²");
    expect(formatoValor("poder_corte_ka", n(10))).toBe("10 kA");
    expect(formatoValor("sensibilidad_ma", n(30))).toBe("30 mA");
    expect(formatoValor("largo_m", n(100))).toBe("100 m");
    expect(formatoValor("largo_m", n(1.2))).toBe("1,2 m");
    expect(formatoValor("angulo_grados", n(36))).toBe("36°");
    expect(formatoValor("leds_m", n(60))).toBe("60 LED/m");
    expect(formatoValor("potencia_w_m", n(14.4))).toBe("14,4 W/m");
    expect(formatoValor("potencia_w_m", n(4.8))).toBe("4,8 W/m");
    expect(formatoValor("leds_rollo", n(300))).toBe("300 LED por rollo");
    expect(formatoValor("leds_rollo", n(1200))).toBe("1.200 LED por rollo");
    expect(formatoValor("diametro_mm", n(25))).toBe("25 mm");
    expect(formatoValor("diametro_mm", n(12.5))).toBe("12,5 mm");
    expect(formatoValor("ancho_mm", n(150))).toBe("150 mm");
    expect(formatoValor("ancho_mm", t("150"))).toBeNull();
    expect(ETIQUETA.diametro_mm).toBe("Diámetro");
    expect(ETIQUETA.ancho_mm).toBe("Ancho");
    expect(formatoValor("dimerizable", t("si"))).toBe("Sí");
    expect(formatoValor("dimerizable", t("no"))).toBe("No");
    expect(formatoValor("dimerizable", t("quizas"))).toBeNull();
    expect(formatoValor("dimerizable", n(1))).toBeNull();
    expect(formatoValor("modulos", n(12))).toBe("12 módulos");
    expect(formatoValor("modulos", n(1))).toBe("1 módulo");
    expect(formatoValor("modulos", n(12.5))).toBeNull();
    expect(formatoValor("modulos", t("12"))).toBeNull();
    expect(ETIQUETA.dimerizable).toBe("Dimerizable");
    expect(ETIQUETA.modulos).toBe("Módulos");
  });

  it("polos: singular, plural y fuera de 1–4 o no entero sin fila", () => {
    expect(formatoValor("polos", n(1))).toBe("1 polo");
    expect(formatoValor("polos", n(2))).toBe("2 polos");
    expect(formatoValor("polos", n(4))).toBe("4 polos");
    expect(formatoValor("polos", n(6))).toBeNull();
    expect(formatoValor("polos", n(2.5))).toBeNull();
  });

  it("medidas: 2 o 3 dimensiones en mm; texto mal formado sin fila", () => {
    expect(formatoValor("medidas_mm", t("300x1200"))).toBe("300 x 1200 mm");
    expect(formatoValor("medidas_mm", t("100x100x50"))).toBe("100 x 100 x 50 mm");
    expect(formatoValor("medidas_mm", t("100x"))).toBeNull();
    expect(formatoValor("medidas_mm", t("abc"))).toBeNull();
  });

  it("color, curva y montaje: vocabulario cerrado", () => {
    expect(formatoValor("color", t("blanco"))).toBe("Blanco");
    expect(formatoValor("color", t("marron"))).toBe("Marrón");
    expect(formatoValor("color", t("fucsia"))).toBeNull();
    expect(formatoValor("curva", t("c"))).toBe("C");
    expect(formatoValor("curva", t("e"))).toBeNull();
    expect(formatoValor("montaje", t("embutir"))).toBe("De embutir");
    expect(formatoValor("montaje", t("aplicar"))).toBe("De aplicar");
    expect(formatoValor("montaje", t("colgante"))).toBe("Colgante");
    expect(formatoValor("montaje", t("riel"))).toBe("Para riel");
    expect(formatoValor("montaje", t("din"))).toBe("Riel DIN");
    expect(formatoValor("montaje", t("pie"))).toBeNull();
  });
});

describe("solo se muestra lo que el producto tiene", () => {
  it("producto con corriente y polos: dos filas, en el orden de las claves, y nada más", () => {
    expect(caracteristicasDe({ polos: n(2), corriente_a: n(25) })).toEqual([
      { etiqueta: "Corriente", valor: "25 A" },
      { etiqueta: "Polos", valor: "2 polos" },
    ]);
  });

  it("producto con sólo las 7 claves previas: idéntico al de antes", () => {
    expect(
      caracteristicasDe({ potencia_w: n(9), temperatura_k: n(3000), tono: t("calido"), ip: n(65), flujo_lm: n(800), tension_v: n(220), zocalo: t("e27") }),
    ).toEqual([
      { etiqueta: "Potencia", valor: "9 W" },
      { etiqueta: "Temperatura de color", valor: "3000 K" },
      { etiqueta: "Tipo de luz", valor: "Cálida" },
      { etiqueta: "Protección", valor: "IP65" },
      { etiqueta: "Flujo luminoso", valor: "800 lm" },
      { etiqueta: "Tensión", valor: "220 V" },
      { etiqueta: "Base / zócalo", valor: "E27" },
    ]);
  });

  it("sin atributos ⇒ sin filas (la ficha no dibuja la sección)", () => {
    expect(caracteristicasDe(undefined)).toEqual([]);
    expect(caracteristicasDe({})).toEqual([]);
  });

  it("claves nuevas con n/t vacíos no dejan fila ni etiqueta", () => {
    const vacios = Object.fromEntries(
      CLAVES_ESTRUCTURADAS.slice(7).map((c) => [c, { n: null, t: null }]),
    ) as AtributosEstructurados;
    expect(caracteristicasDe(vacios)).toEqual([]);
    expect(atributosParaAgente(vacios)).toBeUndefined();
    expect(etiquetasTecnicas(vacios)).toEqual([]);
  });

  it("ningún texto tiene null, undefined, guion ni 'No informado'", () => {
    const filas = caracteristicasDe(MUESTRA);
    expect(filas).toHaveLength(25);
    for (const f of filas) {
      expect(`${f.etiqueta} ${f.valor}`).not.toMatch(/null|undefined|No informado/i);
      expect(f.valor.trim()).not.toBe("-");
    }
  });

  it("un valor corrupto (color fuera de vocabulario) se omite sin romper el resto", () => {
    expect(caracteristicasDe({ color: t("fucsia"), corriente_a: n(16) })).toEqual([{ etiqueta: "Corriente", valor: "16 A" }]);
  });
});

describe("agente y chips con las claves ampliadas", () => {
  it("atributosParaAgente: texto para las categóricas, número para el resto, claves de la base", () => {
    expect(
      atributosParaAgente({
        corriente_a: n(16),
        polos: n(2),
        curva: t("c"),
        color: t("blanco"),
        medidas_mm: t("300x1200"),
        montaje: t("embutir"),
        seccion_mm2: n(2.5),
      }),
    ).toEqual({
      corriente_a: 16,
      polos: 2,
      seccion_mm2: 2.5,
      medidas_mm: "300x1200",
      color: "blanco",
      curva: "c",
      montaje: "embutir",
    });
  });

  it("curva sin color: incluye la curva y no menciona el color", () => {
    const r = atributosParaAgente({ curva: t("c") });
    expect(r).toEqual({ curva: "c" });
    expect(r).not.toHaveProperty("color");
  });

  it("un valor fuera de vocabulario no llega al agente", () => {
    expect(atributosParaAgente({ color: t("fucsia"), polos: n(2) })).toEqual({ polos: 2 });
  });

  it("chips: una termomagnética da corriente, polos y poder de corte; color/curva/montaje no son chips", () => {
    expect(
      etiquetasTecnicas({ poder_corte_ka: n(6), polos: n(2), corriente_a: n(16), curva: t("c"), color: t("blanco"), montaje: t("din") }),
    ).toEqual(["16 A", "2 polos", "6 kA"]);
  });

  it("chips: las cinco de siempre van primero y el tope es 6", () => {
    const chips = etiquetasTecnicas(MUESTRA);
    expect(chips).toEqual(["12 W", "3000 K", "900 lm", "IP65", "220 V", "25 A"]);
    expect(chips).toHaveLength(6);
  });
});

describe("tipo de luz (tono) y color del producto", () => {
  it("etiquetas", () => {
    expect(ETIQUETA.tono).toBe("Tipo de luz");
    expect(ETIQUETA.color).toBe("Color del producto");
  });

  it("formato de las luces de color y RGB", () => {
    const f = (t: string) => formatoValor("tono", { n: null, t });
    expect(["calido", "neutro", "frio", "rojo", "verde", "azul", "amarillo", "naranja", "ambar", "violeta", "rosa", "rgb", "rgbw"].map(f)).toEqual([
      "Cálida", "Neutra", "Fría", "Roja", "Verde", "Azul", "Amarilla", "Naranja", "Ámbar", "Violeta", "Rosa", "RGB", "RGBW",
    ]);
    expect(f("turquesa")).toBeNull();
  });

  it("el agente recibe el tipo de luz de color, no uno inventado", () => {
    expect(atributosParaAgente({ tono: { n: null, t: "verde" } })).toEqual({ tono: "verde" });
    expect(atributosParaAgente({ tono: { n: null, t: "turquesa" } })).toBeUndefined();
  });
});
