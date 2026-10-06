import { describe, expect, it } from "vitest";
import fixture from "../../../db/__fixtures__/medidas-dorados.json";
import { esTokenMedida, medidasDeConsulta, type Medida } from "./medidas";
import { RANGOS, ZOCALOS, CURVAS, DIMENSION_MM, CLAVES_ENTERAS } from "../../catalogo-atributos-medida";

/** La forma que fija el fixture: sin los extras (origen, texto, tokens, unidad). */
function simple(m: Medida) {
  const { clave, op, valor, min, max, confianza, alternativas } = m;
  return {
    clave,
    op,
    ...(valor !== undefined ? { valor } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    confianza,
    ...(alternativas ? { alternativas } : {}),
  };
}
const leer = (q: string) => medidasDeConsulta(q).map(simple);
const eq = (clave: string, valor: number | string, confianza = "alta") => ({ clave, op: "eq", valor, confianza });

describe("medidasDeConsulta: corpus dorado", () => {
  it("el fixture trae casos", () => {
    expect(fixture.casos.length).toBeGreaterThanOrEqual(53);
  });

  for (const caso of fixture.casos) {
    it(`${caso.id}: "${caso.consulta}"`, () => {
      expect(leer(caso.consulta)).toEqual(caso.esperado);
    });
  }
});

describe("R1.1 consulta cruda y coma decimal", () => {
  it("coma decimal: 9,5w es 9.5 y no 5", () => {
    expect(leer("lampara 9,5w")).toEqual([eq("potencia_w", 9.5)]);
  });

  it("la consulta ya normalizada rompe el valor (lectura literal); M3 debe pasar la CRUDA", () => {
    // normalizarConsulta("lampara 9,5w") === "lampara 9 5w": acá se documenta, no se arregla.
    expect(leer("lampara 9 5w")).toEqual([eq("potencia_w", 5)]);
  });

  it("separador entre número y unidad, mayúsculas y tildes", () => {
    for (const q of ["9 w", "9W", "9w", "9 W"]) expect(leer(q)).toEqual([eq("potencia_w", 9)]);
    expect(leer("LÁMPARA 9W E27")).toEqual([eq("potencia_w", 9), eq("zocalo", "e27")]);
  });

  it("punto o coma decimal entre dígitos son lo mismo", () => {
    expect(leer("cable 2,5mm")).toEqual(leer("cable 2.5mm"));
  });
});

describe("R1.2 unidades explicitas", () => {
  it.each([
    ["20a", "corriente_a", 20],
    ["20 amp", "corriente_a", 20],
    ["20 amperes", "corriente_a", 20],
    ["20 amperios", "corriente_a", 20],
    ["9w", "potencia_w", 9],
    ["9 watts", "potencia_w", 9],
    ["9 watt", "potencia_w", 9],
    ["2kw", "potencia_w", 2000],
    ["0,75kw", "potencia_w", 750],
    ["4000k", "temperatura_k", 4000],
    ["12v", "tension_v", 12],
    ["24vcc", "tension_v", 24],
    ["220 vca", "tension_v", 220],
    ["12 volts", "tension_v", 12],
    ["6ka", "poder_corte_ka", 6],
    ["30ma", "sensibilidad_ma", 30],
    ["2,5mm2", "seccion_mm2", 2.5],
    ["2,5 mm²", "seccion_mm2", 2.5],
    ["5m", "largo_m", 5],
    ["5 mts", "largo_m", 5],
    ["5 mt", "largo_m", 5],
    ["5 metros", "largo_m", 5],
    ["ip54", "ip", 54],
    ["ip 54", "ip", 54],
    ["ip-54", "ip", 54],
    ["800 lm", "flujo_lm", 800],
    ["800 lumenes", "flujo_lm", 800],
    ["60°", "angulo_grados", 60],
    ["60 grados", "angulo_grados", 60],
  ])("%s", (q, clave, valor) => {
    const r = medidasDeConsulta(q);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ clave, op: "eq", valor, confianza: q === "30ma" ? "media" : "alta" });
  });

  it("zócalos con guion o espacio salen canónicos", () => {
    for (const [q, z] of [["e-27", "e27"], ["e 27", "e27"], ["E27", "e27"], ["gu 5,3", "gu5.3"], ["gu-10", "gu10"], ["mr 16", "mr16"], ["gx53", "gx53"], ["r7s", "r7s"], ["g-13", "g13"], ["e12", "e12"], ["g24", "g24"]] as const)
      expect(leer(q), q).toEqual([eq("zocalo", z)]);
  });

  it("curva explícita y curva + corriente con contexto de protección", () => {
    expect(leer("curva c")).toEqual([eq("curva", "c")]);
    expect(leer("termica curva d")).toEqual([eq("curva", "d")]);
    expect(leer("termica b25")).toEqual([eq("curva", "b"), eq("corriente_a", 25)]);
    expect(leer("termica c16a")).toEqual([eq("curva", "c"), eq("corriente_a", 16)]);
    expect(leer("curva z")).toEqual([]);
  });

  it("kelvin acotado a 4 cifras entre 1800 y 10000", () => {
    for (const q of ["12000k", "1700k", "4000", "999k"]) expect(leer(q), q).toEqual([]);
    expect(leer("10000k")).toEqual([]);
    expect(leer("1800k")).toEqual([eq("temperatura_k", 1800)]);
  });

  it("valores fuera de rango no son medida", () => {
    for (const q of ["0w", "9999999w", "7000a", "5 polos 9p", "2000v", "200ka", "2000ma", "0.4mm2", "ip99", "400 grados"])
      expect(leer(q), q).toEqual([]);
  });

  it("kw se convierte a W con dos decimales", () => {
    expect(leer("0,0015kw")).toEqual([eq("potencia_w", 1.5)]);
  });
});

describe("R1.3 NxM por contexto", () => {
  it("protección: N de 1 a 4 y M en la serie IEC", () => {
    for (const n of [1, 2, 3, 4]) expect(leer(`termica ${n}x16`), String(n)).toEqual([eq("polos", n), eq("corriente_a", 16)]);
    expect(leer("termica 2x7")).toEqual([]);
    expect(leer("termica 5x16")).toEqual([]);
    expect(leer("termica 2×20")).toEqual([eq("polos", 2), eq("corriente_a", 20)]);
  });

  it("cable: sección media, sin polos ni corriente", () => {
    expect(leer("cable 3x2,5mm2")).toEqual([eq("seccion_mm2", 2.5)]);
    expect(leer("cable 2x1,5")).toEqual([eq("seccion_mm2", 1.5, "media")]);
    expect(leer("conductor 4x6")).toEqual([eq("seccion_mm2", 6, "media")]);
  });

  it("panel: centímetros con alternativa, o literal según la unidad explícita", () => {
    expect(medidasDeConsulta("panel 60x60")[0]).toMatchObject({ valor: "600x600", alternativas: ["60x60"], confianza: "media" });
    expect(medidasDeConsulta("panel 60x60cm")[0]).toMatchObject({ valor: "600x600", confianza: "media" });
    expect(medidasDeConsulta("panel 60x60cm")[0].alternativas).toBeUndefined();
    expect(leer("panel 60x60mm")).toEqual([eq("medidas_mm", "60x60", "media")]);
    expect(leer("gabinete 30x40x20")[0]).toMatchObject({ valor: "300x400x200" });
  });

  it("sin contexto no se interpreta", () => {
    for (const q of ["2x20", "60x60", "2 x 20", "led 2x20"]) expect(leer(q), q).toEqual([]);
  });

  it("número suelto: protección media, lámpara baja, resto nada", () => {
    expect(leer("termica 20")).toEqual([eq("corriente_a", 20, "media")]);
    expect(leer("termica 21")).toEqual([]);
    expect(leer("lampara 9")).toEqual([eq("potencia_w", 9, "baja")]);
    expect(leer("foco 12")).toEqual([eq("potencia_w", 12, "baja")]);
    expect(leer("cable 9")).toEqual([]);
    expect(leer("9")).toEqual([]);
  });

  it("mm solo cuenta con contexto cable", () => {
    expect(leer("cable 2,5mm")).toEqual([eq("seccion_mm2", 2.5, "media")]);
    expect(leer("caño 20mm")).toEqual([]);
    expect(leer("2,5mm")).toEqual([]);
  });
});

describe("R1.4-R1.6 preposición, rangos, conflictos y polos", () => {
  it("la 'a' seguida de número no son amperes", () => {
    expect(leer("de 10 a 20w")).toEqual([{ clave: "potencia_w", op: "entre", min: 10, max: 20, confianza: "alta" }]);
    expect(leer("lampara de 10 a 20w").some((m) => m.clave === "corriente_a")).toBe(false);
    expect(leer("termica 20 a")).toEqual([eq("corriente_a", 20)]);
    expect(leer("termica 20 a 25")).toEqual([]);
  });

  it("comparadores", () => {
    expect(leer("hasta 50w")).toEqual([{ clave: "potencia_w", op: "lte", valor: 50, confianza: "alta" }]);
    expect(leer("maximo 32a")[0]).toMatchObject({ op: "lte", valor: 32 });
    expect(leer("menos de 12v")[0]).toMatchObject({ op: "lte", valor: 12 });
    expect(leer("desde 20w")[0]).toMatchObject({ op: "gte", valor: 20 });
    expect(leer("mas de 800 lm")[0]).toMatchObject({ clave: "flujo_lm", op: "gte", valor: 800 });
    expect(leer("minimo 20a")[0]).toMatchObject({ op: "gte", valor: 20 });
    expect(leer("mayor a 20a")[0]).toMatchObject({ op: "gte", valor: 20 });
  });

  it("rangos: con kW se convierte cada extremo; extremos invertidos o fuera de rango no emiten", () => {
    expect(leer("de 1 a 2kw")).toEqual([{ clave: "potencia_w", op: "entre", min: 1000, max: 2000, confianza: "alta" }]);
    expect(leer("de 20 a 10w")).toEqual([]);
    expect(leer("entre 10 y 20w")).toHaveLength(1);
    expect(leer("10-20w")).toEqual([{ clave: "potencia_w", op: "entre", min: 10, max: 20, confianza: "alta" }]);
    expect(leer("85-265v")).toEqual([{ clave: "tension_v", op: "entre", min: 85, max: 265, confianza: "alta" }]);
  });

  it("un rango no cuenta como dos valores distintos", () => {
    expect(leer("9w de 5 a 20w")).toHaveLength(2);
  });

  it("dos valores distintos de una clave: ninguno; el mismo valor repetido: uno", () => {
    expect(leer("20a 25a")).toEqual([]);
    expect(leer("3000k 4000k")).toEqual([]);
    expect(leer("mr16 gu10")).toEqual([]);
    expect(leer("20a 20a")).toEqual([eq("corriente_a", 20)]);
    expect(leer("termica 2x20 25a")).toEqual([eq("polos", 2)]);
    expect(leer("termica 2x20 20a")).toEqual([eq("polos", 2), eq("corriente_a", 20)]);
  });

  it("polos por palabra y por 'p'", () => {
    expect(leer("bipolar 20a")).toEqual([eq("polos", 2), eq("corriente_a", 20)]);
    expect(leer("unipolar 16a")).toEqual([eq("polos", 1), eq("corriente_a", 16)]);
    expect(leer("tetrapolar")).toEqual([eq("polos", 4)]);
    expect(leer("2p")).toEqual([eq("polos", 2)]);
    expect(leer("cable unipolar 2.5mm")).toEqual([eq("seccion_mm2", 2.5, "media")]);
    expect(leer("monofasico 20a")).toEqual([eq("corriente_a", 20)]);
    expect(leer("trifasico")).toEqual([]);
  });
});

describe("R1.7 falsos positivos", () => {
  it.each(["DL-18W", "TM-2x16", "XQ-4471B", "tira led 14w/m", "caño 20mm", "2,5mm", "120cm", "ip70", "ip6", "C479056476B7", "NXB-125", "7791234567890", "220/12", "1200lm/w", "5a/m"])(
    "%s no produce medida",
    (q) => {
      expect(leer(q)).toEqual([]);
    },
  );

  it("la eficiencia y lo 'por metro' se descartan sin tapar el resto", () => {
    expect(leer("tira led 14w/m 24v")).toEqual([eq("tension_v", 24)]);
    expect(leer("lampara 9w 110 lm/w")).toEqual([eq("potencia_w", 9)]);
  });
});

describe("salida canónica", () => {
  it("orden de aparición, unidad canónica y tokens", () => {
    const r = medidasDeConsulta("tira led 12v 5m");
    expect(r.map((m) => m.clave)).toEqual(["tension_v", "largo_m"]);
    expect(r[0]).toMatchObject({ unidad: "V", tokens: ["12v"], origen: "unidad" });
    expect(r[1]).toMatchObject({ unidad: "m", tokens: ["5m"] });
    expect(medidasDeConsulta("bipolar 20a").map((m) => m.clave)).toEqual(["polos", "corriente_a"]);
  });

  it("origen distingue la fuente de la lectura", () => {
    expect(medidasDeConsulta("termica 2x20")[0].origen).toBe("nxm-proteccion");
    expect(medidasDeConsulta("de 10 a 20w")[0].origen).toBe("rango");
    expect(medidasDeConsulta("hasta 5a")[0].origen).toBe("rango");
    expect(medidasDeConsulta("bipolar")[0].origen).toBe("palabra");
    expect(medidasDeConsulta("lampara 9")[0].origen).toBe("hipotesis");
  });
});

describe("R1.8 pureza y robustez", () => {
  /** PRNG determinista (mulberry32): el fuzz es reproducible. */
  function prng(semilla: number) {
    let a = semilla;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ALFABETO = [..."0123456789 ,.-/x×°²aAwWvVkKmMiIpPeEgGuUrRcCbBdDñáéíóúü()+%", "ip", "mm2", "kw", "ka", "ma", "termica ", "cable ", "panel ", "lampara ", "hasta ", "de ", " a ", "bipolar", "e27", "😀", "\n", "\t"];
  const aleatoria = (r: () => number) => {
    const largo = Math.floor(r() * 200) + 1;
    let s = "";
    while (s.length < largo) s += ALFABETO[Math.floor(r() * ALFABETO.length)];
    return s.slice(0, 200);
  };

  function respetaVocabulario(m: Medida) {
    const rango = RANGOS[m.clave];
    const numeros = [m.valor, m.min, m.max].filter((x): x is number => typeof x === "number");
    for (const n of numeros) {
      expect(Number.isFinite(n)).toBe(true);
      if (rango) {
        expect(n).toBeGreaterThanOrEqual(rango[0]);
        expect(n).toBeLessThanOrEqual(rango[1]);
      }
      if ((CLAVES_ENTERAS as readonly string[]).includes(m.clave)) expect(Number.isInteger(n)).toBe(true);
    }
    if (m.clave === "zocalo") expect(ZOCALOS as readonly string[]).toContain(m.valor);
    if (m.clave === "curva") expect(CURVAS as readonly string[]).toContain(m.valor);
    if (m.clave === "medidas_mm") {
      expect(m.valor).toMatch(/^\d+(\.\d+)?(x\d+(\.\d+)?){1,2}$/);
      for (const d of String(m.valor).split("x")) {
        expect(Number(d)).toBeGreaterThanOrEqual(DIMENSION_MM[0]);
        expect(Number(d)).toBeLessThanOrEqual(DIMENSION_MM[1]);
      }
    }
    if (m.op === "entre") expect(m.min!).toBeLessThan(m.max!);
    expect(m.tokens.length).toBeGreaterThan(0);
  }

  it("fuzz: 2000 cadenas aleatorias no lanzan, tardan < 50 ms y respetan el vocabulario", () => {
    const r = prng(20261006);
    for (let i = 0; i < 2000; i++) {
      const q = aleatoria(r);
      const t0 = performance.now();
      const res = medidasDeConsulta(q);
      expect(performance.now() - t0, JSON.stringify(q)).toBeLessThan(50);
      for (const m of res) respetaVocabulario(m);
    }
  });

  it("cadenas patológicas terminan rápido", () => {
    const patologicas = ["1".repeat(200) + "x", "x".repeat(200), "1x".repeat(100), "1,".repeat(100), "1.".repeat(100), " ".repeat(200), "ip".repeat(100), "de 1 a ".repeat(30), "9 ".repeat(100) + "w", "1".repeat(5000)];
    for (const q of patologicas) {
      const t0 = performance.now();
      expect(() => medidasDeConsulta(q)).not.toThrow();
      expect(performance.now() - t0, q.slice(0, 20)).toBeLessThan(50);
    }
  });

  it("es idempotente y no comparte estado entre llamadas", () => {
    for (const caso of fixture.casos) {
      const a = medidasDeConsulta(caso.consulta);
      const b = medidasDeConsulta(caso.consulta);
      expect(b).toEqual(a);
    }
    const a = medidasDeConsulta("termica 2x20");
    a.pop();
    expect(medidasDeConsulta("termica 2x20")).toHaveLength(2);
  });

  it("1000 consultas normales en menos de 1 s", () => {
    const base = ["lampara led 9w e27 calida", "termica 2x20", "cable 2,5mm", "tira led 12v 5m", "panel 60x60", "ip65 proyector", "diferencial 40a 30ma", "algo para iluminar el patio"];
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) medidasDeConsulta(base[i % base.length]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("tolera entradas no string", () => {
    expect(medidasDeConsulta(undefined as unknown as string)).toEqual([]);
    expect(medidasDeConsulta(null as unknown as string)).toEqual([]);
    expect(medidasDeConsulta(12 as unknown as string)).toEqual([]);
  });
});

describe("esTokenMedida (forma léxica + rango; NxM puro léxico)", () => {
  it.each(["20a", "ip65", "e27", "9w", "6ka", "4000k", "24v", "30ma", "gu10", "2x20", "60x60", "20A", "E27", "9,5w", "2.5mm2", "5m"])("%s es medida", (t) => {
    expect(esTokenMedida(t)).toBe(true);
  });

  it.each(["DL-18W", "TM-2x16", "XQ-4471B", "C479056476B7", "NXB-125", "c16", "100", "7791234567890", "12000k", "ip70", "9999999w", "4471b", "220/12", "", "  ", "termica", "9w/m", "lampara 9w"])("%s sigue siendo código o texto", (t) => {
    expect(esTokenMedida(t)).toBe(false);
  });

  it("tolera entradas no string", () => {
    expect(esTokenMedida(undefined as unknown as string)).toBe(false);
  });
});
