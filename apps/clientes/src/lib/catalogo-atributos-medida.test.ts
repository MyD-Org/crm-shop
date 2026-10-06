import { describe, expect, it } from "vitest";
import fixture from "../db/__fixtures__/medidas-dorados.json";
import {
  CLAVES_MEDIDA,
  ESPECIFICACION,
  MAX_LARGO_ID,
  RANGOS,
  criterioDeMedida,
  esMedidaId,
  formatoEtiqueta,
  grupoDeMedida,
  idDeMedida,
  leerIdMedida,
  patronDeMedida,
  type ClaveMedida,
} from "./catalogo-atributos-medida";

const VALIDOS = ["corriente_a:20", "polos:2", "potencia_w:8-10", "zocalo:e14", "curva:c", "ip:65", "medidas_mm:600x600"];

const INVALIDOS = [
  "corriente_a:0",
  "corriente_a:-5",
  "corriente_a:1e9",
  "corriente_a:7000",
  "polos:5",
  "polos:0",
  "polos:2.5",
  "polos:1-2",
  "potencia_w:10-5",
  "potencia_w:5-5",
  "potencia_w:8-",
  "potencia_w:-8",
  "potencia_w:1-2-3",
  "zocalo:E27",
  "zocalo:e99",
  "zocalo:b22",
  "zocalo:8",
  "ip:70",
  "ip:9",
  "ip:6.5",
  "ip:50-60",
  "curva:z",
  "curva:C",
  "clave_falsa:1",
  "tono:calido",
  "color:blanco",
  "corriente_a:20' OR 1=1--",
  "polos:2;drop table x",
  "corriente_a:",
  ":20",
  "corriente_a:20:30",
  "corriente_a20",
  "corriente_a:020",
  "corriente_a:20.0",
  "corriente_a:20.50",
  "corriente_a:2e1",
  "corriente_a:+20",
  "corriente_a:1,5",
  "corriente_a: 20",
  "corriente_a:20 ",
  "CORRIENTE_A:20",
  "Corriente_a:20",
  "corriente_a:99999999",
  "medidas_mm:600",
  "medidas_mm:0x600",
  "medidas_mm:10000x600",
  "medidas_mm:600x600x600x600",
  "medidas_mm:600X600",
  "medidas_mm:060x60",
  "medidas_mm:60.5x60",
  "",
  ":",
  "a:b",
  `corriente_a:${"1".repeat(30)}`,
  `${"a".repeat(41)}:20`,
];

describe("ids dinámicos válidos (R4.1)", () => {
  it.each(VALIDOS)("%s", (id) => {
    expect(leerIdMedida(id)).not.toBeNull();
    expect(esMedidaId(id)).toBe(true);
  });

  it("forma de lo leído", () => {
    expect(leerIdMedida("corriente_a:20")).toEqual({ clave: "corriente_a", op: "eq", valor: 20 });
    expect(leerIdMedida("potencia_w:8-10")).toEqual({ clave: "potencia_w", op: "entre", min: 8, max: 10 });
    expect(leerIdMedida("potencia_w:9.5")).toEqual({ clave: "potencia_w", op: "eq", valor: 9.5 });
    expect(leerIdMedida("zocalo:gu5.3")).toEqual({ clave: "zocalo", op: "eq", valor: "gu5.3" });
    expect(leerIdMedida("medidas_mm:30x40x20")).toEqual({ clave: "medidas_mm", op: "eq", valor: "30x40x20" });
    expect(leerIdMedida("ip:65")).toEqual({ clave: "ip", op: "eq", valor: 65 });
  });

  it("los bordes de cada rango entran y lo de afuera no", () => {
    for (const clave of CLAVES_MEDIDA) {
      const r = RANGOS[clave];
      if (!r || !ESPECIFICACION[clave].ops.includes("eq")) continue;
      const fmt = (n: number) => `${clave}:${n}`;
      expect(leerIdMedida(fmt(r[0])), fmt(r[0])).not.toBeNull();
      expect(leerIdMedida(fmt(r[1])), fmt(r[1])).not.toBeNull();
      expect(leerIdMedida(fmt(r[1] + 1)), fmt(r[1] + 1)).toBeNull();
      if (r[0] > 1) expect(leerIdMedida(fmt(r[0] - 1)), fmt(r[0] - 1)).toBeNull();
    }
  });
});

describe("ids inválidos (R4.1)", () => {
  it.each(INVALIDOS)("%j se rechaza", (id) => {
    expect(leerIdMedida(id)).toBeNull();
    expect(esMedidaId(id)).toBe(false);
  });

  it("largo máximo", () => {
    expect(MAX_LARGO_ID).toBe(40);
    expect(leerIdMedida("a".repeat(41))).toBeNull();
  });

  it("tolera no-strings", () => {
    for (const x of [undefined, null, 12, {}, []] as unknown[]) expect(leerIdMedida(x as string)).toBeNull();
  });
});

describe("idDeMedida y round-trip canónico", () => {
  it("eq da clave:valor y entre da la banda", () => {
    expect(idDeMedida({ clave: "corriente_a", op: "eq", valor: 20 })).toBe("corriente_a:20");
    expect(idDeMedida({ clave: "potencia_w", op: "eq", valor: 9.5 })).toBe("potencia_w:9.5");
    expect(idDeMedida({ clave: "potencia_w", op: "entre", min: 8, max: 10 })).toBe("potencia_w:8-10");
    expect(idDeMedida({ clave: "zocalo", op: "eq", valor: "e27" })).toBe("zocalo:e27");
    expect(idDeMedida({ clave: "medidas_mm", op: "eq", valor: "600x600" })).toBe("medidas_mm:600x600");
  });

  it("lte y gte no tienen id", () => {
    expect(idDeMedida({ clave: "potencia_w", op: "lte", valor: 50 })).toBeNull();
    expect(idDeMedida({ clave: "potencia_w", op: "gte", valor: 50 })).toBeNull();
  });

  it("valores que la gramática rechaza no generan id", () => {
    expect(idDeMedida({ clave: "polos", op: "eq", valor: 5 })).toBeNull();
    expect(idDeMedida({ clave: "polos", op: "eq", valor: 2.5 })).toBeNull();
    expect(idDeMedida({ clave: "corriente_a", op: "eq", valor: 0.1 + 0.2 })).toBeNull();
    expect(idDeMedida({ clave: "corriente_a", op: "eq", valor: Number.NaN })).toBeNull();
    expect(idDeMedida({ clave: "corriente_a", op: "eq", valor: Infinity })).toBeNull();
    expect(idDeMedida({ clave: "corriente_a", op: "eq", valor: "20" })).toBeNull();
    expect(idDeMedida({ clave: "tono", op: "eq", valor: "calido" })).toBeNull();
    expect(idDeMedida({ clave: "potencia_w", op: "entre", min: 10, max: 5 })).toBeNull();
    expect(idDeMedida({ clave: "polos", op: "entre", min: 1, max: 2 })).toBeNull();
    expect(idDeMedida({ clave: "ip", op: "eq", valor: 70 })).toBeNull();
    expect(idDeMedida({ clave: "zocalo", op: "eq", valor: "E27" })).toBeNull();
    expect(idDeMedida({ clave: "corriente_a", op: "eq" })).toBeNull();
  });

  it("idDeMedida(leerIdMedida(x)) === x para todo id válido", () => {
    const generados: string[] = [...VALIDOS, "zocalo:gu5.3", "tension_v:85-265", "tension_v:12", "largo_m:0.5", "seccion_mm2:2.5", "ip:10", "curva:d", "medidas_mm:30x40x20"];
    for (const clave of CLAVES_MEDIDA) {
      const r = RANGOS[clave];
      if (r) generados.push(`${clave}:${r[0]}`, `${clave}:${r[1]}`);
    }
    for (const id of generados) {
      const m = leerIdMedida(id);
      expect(m, id).not.toBeNull();
      expect(idDeMedida(m!), id).toBe(id);
    }
  });

  it("el parser y la gramática cierran el círculo con los casos del fixture", () => {
    // Los esperados del fixture que son eq/entre con clave de id y valor válido producen un id estable.
    for (const caso of fixture.casos) {
      for (const m of caso.esperado) {
        const id = idDeMedida(m as Parameters<typeof idDeMedida>[0]);
        if (id) expect(idDeMedida(leerIdMedida(id)!)).toBe(id);
      }
    }
  });
});

describe("rangos y vocabulario == fixture (R3.2)", () => {
  it("la especificación coincide con fixture.vocabulario", () => {
    expect([...CLAVES_MEDIDA]).toEqual(fixture.vocabulario.claves);
    for (const [clave, rango] of Object.entries(fixture.vocabulario.rangos)) expect([...RANGOS[clave as ClaveMedida]!], clave).toEqual(rango);
    expect(ESPECIFICACION.zocalo.valores).toEqual(fixture.vocabulario.zocalos);
    expect(ESPECIFICACION.curva.valores).toEqual(fixture.vocabulario.curvas);
    for (const c of CLAVES_MEDIDA) expect(ESPECIFICACION[c], c).toBeDefined();
  });
});

describe("seguridad: fuzz e inyección (NFR-1)", () => {
  const PAYLOADS = [
    "polos:1' or 1=1--",
    "corriente_a:20)",
    "corriente_a:20) OR (1=1",
    "potencia_w:1-0",
    "corriente_a:20\u0000",
    "corriente_a:20\n",
    "zocalo:e27'--",
    "curva:c;select 1",
    "ip:65 union select",
    "medidas_mm:1x1'--",
    "corriente_a:$1",
    "corriente_a:%27",
    "corriente_a:20%20or%201=1",
    "polos:1\\x27",
    "(?:a+)+$",
    "corriente_a:.*",
    "corriente_a:[0-9]+",
    "٣:٢",
    "corriente_a:٢٠",
    "corriente_a:２０",
    `${"corriente_a:".repeat(50)}`,
    "corriente_a:" + "9".repeat(10_000),
    "e".repeat(100_000),
  ];

  /** Todo id aceptado cumple la forma cerrada y es canónico. */
  function aceptadoEsSeguro(id: string) {
    const m = leerIdMedida(id);
    if (!m) return;
    expect(id).toMatch(/^[a-z][a-z0-9_]{1,19}:[a-z0-9.-]{1,16}$/);
    expect(id.length).toBeLessThanOrEqual(MAX_LARGO_ID);
    expect(idDeMedida(m)).toBe(id);
    expect(id).not.toMatch(/['";\\()%\s]/);
    const c = criterioDeMedida(m);
    expect(CLAVES_MEDIDA).toContain(c.clave);
  }

  it("los payloads se rechazan sin lanzar y en tiempo acotado", () => {
    for (const p of PAYLOADS) {
      const t0 = performance.now();
      expect(leerIdMedida(p), p.slice(0, 40)).toBeNull();
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });

  it("5000 cadenas aleatorias: ninguna lanza y toda aceptada es canónica", () => {
    let a = 20261006;
    const rnd = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const piezas = [...CLAVES_MEDIDA, ":", "-", ".", "x", "0", "1", "2", "5", "9", "20", "65", "e27", "c", "b", "gu5.3", "'", " ", "OR", "e", "_", "ñ", "٢"];
    let aceptados = 0;
    for (let i = 0; i < 5000; i++) {
      let s = "";
      const n = Math.floor(rnd() * 6) + 1;
      for (let j = 0; j < n; j++) s += piezas[Math.floor(rnd() * piezas.length)];
      aceptadoEsSeguro(s);
      if (leerIdMedida(s)) aceptados++;
    }
    expect(aceptados).toBeGreaterThan(0);
  });

  it("el valor viaja solo como dato: el criterio no arma texto SQL", () => {
    for (const id of VALIDOS) {
      const c = criterioDeMedida(leerIdMedida(id)!);
      expect(JSON.stringify(c)).not.toMatch(/['`;\\]/);
    }
  });
});

describe("criterioDeMedida (CriterioEstructurado)", () => {
  const c = (id: string) => criterioDeMedida(leerIdMedida(id)!);

  it("eq numérica, tensión con rango nominal, IP mínimo, textos y banda", () => {
    expect(c("corriente_a:20")).toEqual({ clave: "corriente_a", numeros: [20] });
    expect(c("polos:2")).toEqual({ clave: "polos", numeros: [2] });
    expect(c("tension_v:110")).toEqual({ clave: "tension_v", numeros: [110], enRango: 110 });
    expect(c("ip:54")).toEqual({ clave: "ip", desde: 54 });
    expect(c("zocalo:e14")).toEqual({ clave: "zocalo", textos: ["e14"] });
    expect(c("curva:c")).toEqual({ clave: "curva", textos: ["c"] });
    expect(c("potencia_w:8-10")).toEqual({ clave: "potencia_w", desde: 8, hasta: 10 });
    expect(c("medidas_mm:600x600")).toEqual({ clave: "medidas_mm", textos: ["600x600"] });
  });
});

describe("patronDeMedida (ARE común JS/PG)", () => {
  const p = (id: string) => patronDeMedida(leerIdMedida(id)!);
  const prueba = (id: string, texto: string) => new RegExp(p(id)!, "i").test(texto);

  it("polos, curva, banda y medidas_mm no tienen patrón", () => {
    for (const id of ["polos:2", "curva:c", "potencia_w:8-10", "medidas_mm:600x600"]) expect(p(id), id).toBeUndefined();
  });

  it("corriente: 20 A sí, 120 A y 20 V no", () => {
    expect(prueba("corriente_a:20", "interruptor termomagnetico 20a")).toBe(true);
    expect(prueba("corriente_a:20", "interruptor 20 amperes")).toBe(true);
    expect(prueba("corriente_a:20", "interruptor 120a")).toBe(false);
    expect(prueba("corriente_a:20", "interruptor 20v")).toBe(false);
    expect(prueba("corriente_a:20", "interruptor 20")).toBe(false);
  });

  it("potencia, tensión, sensibilidad, flujo, sección, poder de corte, kelvin, largo y grados", () => {
    expect(prueba("potencia_w:9", "lampara led 9w")).toBe(true);
    expect(prueba("potencia_w:9.5", "lampara led 9,5 w")).toBe(true);
    expect(prueba("potencia_w:9", "lampara led 19w")).toBe(false);
    expect(prueba("tension_v:12", "tira 12v")).toBe(true);
    expect(prueba("tension_v:12", "tira 112v")).toBe(false);
    expect(prueba("sensibilidad_ma:30", "diferencial 30ma")).toBe(true);
    expect(prueba("flujo_lm:800", "lampara 800 lm")).toBe(true);
    expect(prueba("seccion_mm2:2.5", "cable 2,5mm2")).toBe(true);
    expect(prueba("poder_corte_ka:6", "termica 6ka")).toBe(true);
    expect(prueba("temperatura_k:4000", "led 4000k")).toBe(true);
    expect(prueba("largo_m:5", "tira 5m")).toBe(true);
    expect(prueba("largo_m:5", "tira 5mm")).toBe(false);
    expect(prueba("angulo_grados:60", "reflector 60 grados")).toBe(true);
  });

  it("IP: el pedido y lo superior; zócalo con guion o espacio", () => {
    expect(prueba("ip:54", "proyector ip54")).toBe(true);
    expect(prueba("ip:54", "proyector ip65")).toBe(true);
    expect(prueba("ip:54", "proyector ip44")).toBe(false);
    expect(prueba("zocalo:e27", "lampara e-27")).toBe(true);
    expect(prueba("zocalo:e27", "lampara e 27")).toBe(true);
    expect(prueba("zocalo:e27", "lampara e270")).toBe(false);
    expect(prueba("zocalo:gu5.3", "dicroica gu5,3")).toBe(true);
  });

  it("solo usa el subconjunto común de JS y Postgres (sin lookaround, \\d ni cuantificadores perezosos)", () => {
    for (const id of VALIDOS) {
      const patron = p(id);
      if (!patron) continue;
      expect(patron).not.toMatch(/\(\?[=!<:]|\\[dswb]|[*+?}]\?/);
    }
  });
});

describe("formatoEtiqueta (es-AR, registro neutro)", () => {
  const e = (id: string) => formatoEtiqueta(leerIdMedida(id)!);

  it("etiquetas del plan", () => {
    expect(e("corriente_a:20")).toBe("Corriente: 20 A");
    expect(e("polos:2")).toBe("Polos: 2");
    expect(e("potencia_w:8-10")).toBe("Potencia: 8 a 10 W");
    expect(e("zocalo:e14")).toBe("Zócalo: E14");
    expect(e("tension_v:12")).toBe("Tensión: 12 V");
    expect(e("ip:54")).toBe("IP54 o superior");
    expect(e("potencia_w:9.5")).toBe("Potencia: 9,5 W");
    expect(e("curva:c")).toBe("Curva: C");
    expect(e("medidas_mm:600x600")).toBe("Medidas: 600 x 600 mm");
    expect(e("temperatura_k:4000")).toBe("Temperatura de color: 4000 K");
    expect(e("seccion_mm2:2.5")).toBe("Sección: 2,5 mm²");
    expect(e("angulo_grados:60")).toBe("Ángulo: 60°");
    expect(e("flujo_lm:1200")).toBe("Flujo luminoso: 1200 lm");
  });

  it("sin voseo ni coloquialismos", () => {
    for (const id of VALIDOS) expect(e(id)).not.toMatch(/\b(vos|tu|tus|che|dale)\b/i);
  });
});

describe("grupos", () => {
  it("grupoDeMedida arma `medida:<clave>`", () => {
    expect(grupoDeMedida("corriente_a")).toBe("medida:corriente_a");
  });
});
