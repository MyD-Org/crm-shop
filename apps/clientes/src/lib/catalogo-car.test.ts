import { describe, expect, it } from "vitest";
import { atributoPorId } from "./catalogo-atributos";
import { MAX_CAR, claveDeCar, etiquetaCar, filtrosPorTipo, idCar, leerCar, leerIdCar } from "./catalogo-car";

describe("leerIdCar", () => {
  it.each([
    ["polos:2", { clave: "polos", op: "valor", valor: "2" }],
    ["curva:c", { clave: "curva", op: "valor", valor: "c" }],
    ["corriente_a:0.5", { clave: "corriente_a", op: "valor", valor: "0.5" }],
    ["ip:54", { clave: "ip", op: "valor", valor: "54" }],
    ["zocalo:gu5.3", { clave: "zocalo", op: "valor", valor: "gu5.3" }],
    ["tono:calido", { clave: "tono", op: "valor", valor: "calido" }],
    ["flujo_lm:800-1200", { clave: "flujo_lm", op: "rango", min: 800, max: 1200 }],
    ["largo_m:1.5-10", { clave: "largo_m", op: "rango", min: 1.5, max: 10 }],
    ["diametro_mm:25", { clave: "diametro_mm", op: "valor", valor: "25" }],
    ["diametro_mm:12.5", { clave: "diametro_mm", op: "valor", valor: "12.5" }],
    ["ancho_mm:150", { clave: "ancho_mm", op: "valor", valor: "150" }],
  ])("%s es válido", (id, esperado) => {
    expect(leerIdCar(id)).toEqual(esperado);
  });

  it.each([
    "polos:99", // fuera del rango válido
    "polos:0",
    "polos:2.5", // polos es entero
    "polos:02", // no canónico
    "polos:2;drop",
    "polos:2 ",
    "polos:",
    "polos",
    ":2",
    "Polos:2",
    "desconocida:1",
    "medidas_mm:10x10", // clave fuera del registro
    "leds_m:30",
    "diametro_mm:4", // fuera de 5-200
    "diametro_mm:201",
    "diametro_mm:025", // no canónico
    "diametro_mm:20-25", // clave de lista: sólo valor exacto
    "ancho_mm:20", // fuera de 30-1000
    "ancho_mm:1001",
    "potencia_w:10-50", // la potencia usa potencia_min/max
    "potencia_w:10",
    "flujo_lm:800", // una clave de rango solo admite rango
    "polos:1-2", // una clave de lista solo admite valor exacto
    "flujo_lm:1200-800", // min > max
    "flujo_lm:800-800",
    "flujo_lm:0-800", // fuera del rango válido
    "flujo_lm:800-2000000",
    "ip:5", // IP fuera de 10-69
    "tono:ñandú",
    "tono:" + "a".repeat(25),
    "flujo_lm:" + "1".repeat(40),
  ])("%j se descarta", (id) => {
    expect(leerIdCar(id)).toBeNull();
  });

  it("no acepta lo que no es texto", () => {
    expect(leerIdCar(undefined as unknown as string)).toBeNull();
    expect(leerIdCar(7 as unknown as string)).toBeNull();
  });
});

describe("idCar", () => {
  it("arma el id canónico", () => {
    expect(idCar({ clave: "polos", valor: "2" })).toBe("polos:2");
    expect(idCar({ clave: "polos", valor: 2 })).toBe("polos:2");
    expect(idCar({ clave: "flujo_lm", min: 800, max: 1200 })).toBe("flujo_lm:800-1200");
  });

  it("devuelve null si lo armado no pasa la gramática (vuelve igual por leerIdCar)", () => {
    expect(idCar({ clave: "polos", valor: "99" })).toBeNull();
    expect(idCar({ clave: "potencia_w", min: 1, max: 5 })).toBeNull();
    expect(idCar({ clave: "inventada", valor: "x" })).toBeNull();
    expect(idCar({ clave: "flujo_lm", min: 5, max: 1 })).toBeNull();
  });
});

describe("leerCar", () => {
  it("round trip: se lee y se vuelve a emitir idéntico y en orden fijo", () => {
    const url = ["polos:2", "polos:4", "curva:c"];
    const leido = leerCar(url);
    expect(leido).toEqual(url);
    expect(leerCar(leido)).toEqual(url);
  });

  it("el orden de emisión es fijo sin importar el orden de entrada", () => {
    const a = leerCar(["curva:c", "polos:4", "polos:2", "corriente_a:20", "corriente_a:6"]);
    const b = leerCar(["corriente_a:6", "polos:2", "corriente_a:20", "curva:c", "polos:4"]);
    expect(a).toEqual(b);
    // orden del registro (corriente, polos, curva) y, dentro de una clave, los números de menor a mayor
    expect(a).toEqual(["corriente_a:6", "corriente_a:20", "polos:2", "polos:4", "curva:c"]);
  });

  it("los rangos van por su mínimo", () => {
    expect(leerCar(["largo_m:5-10", "largo_m:1-3"])).toEqual(["largo_m:1-3", "largo_m:5-10"]);
  });

  it("descarta lo inválido sin error y conserva lo válido", () => {
    expect(leerCar(["polos:99", "desconocida:1", "polos:2;drop", "polos:2"])).toEqual(["polos:2"]);
  });

  it("descarta duplicados", () => {
    expect(leerCar(["polos:2", "polos:2", "polos:2"])).toEqual(["polos:2"]);
  });

  it("tope de 8 ids", () => {
    const muchos = ["1", "2", "3", "4"].flatMap((p) => [`polos:${p}`, `corriente_a:${p}`, `tension_v:${p}`]);
    expect(muchos.length).toBeGreaterThan(MAX_CAR);
    expect(leerCar(muchos)).toHaveLength(MAX_CAR);
  });

  it("sin ids da una lista vacía", () => {
    expect(leerCar([])).toEqual([]);
  });

  it("coexiste con ?atr=: el mismo id en car y en atr se lee cada uno por su lado", () => {
    expect(leerCar(["corriente_a:20"])).toEqual(["corriente_a:20"]);
    // `atr` sigue resolviendo su medida por su propia gramática, que car no toca
    expect(atributoPorId("corriente_a:20")).toBeDefined();
  });
});

describe("claveDeCar", () => {
  it("devuelve la clave de un id", () => {
    expect(claveDeCar("polos:2")).toBe("polos");
    expect(claveDeCar("flujo_lm:800-1200")).toBe("flujo_lm");
  });
});

describe("etiquetaCar", () => {
  it.each([
    ["polos:2", "Polos: 2"],
    ["curva:c", "Curva: C"],
    ["corriente_a:20", "Corriente: 20 A"],
    ["corriente_a:0.5", "Corriente: 0,5 A"],
    ["ip:54", "Protección: IP54"],
    ["zocalo:e27", "Zócalo: E27"],
    ["tono:calido", "Tipo de luz: Cálido"],
    ["color:marron", "Color: Marrón"],
    ["flujo_lm:800-1200", "Flujo luminoso: 800 – 1200 lm"],
    ["largo_m:1.5-10", "Largo: 1,5 – 10 m"],
  ])("%s -> %s", (id, esperada) => {
    expect(etiquetaCar(id)).toBe(esperada);
  });

  it("un id inválido se devuelve tal cual", () => {
    expect(etiquetaCar("desconocida:1")).toBe("desconocida:1");
  });
});

describe("filtrosPorTipo (lo que la page suma a los filtros)", () => {
  it("apagado (flag o tabla): nada, y car en la URL se ignora", () => {
    expect(filtrosPorTipo(false, ["polos:2"])).toEqual({});
    expect(filtrosPorTipo(false, undefined)).toEqual({});
  });

  it("prendido: el flag y los car válidos en orden canónico (un valor suelto o repetido)", () => {
    expect(filtrosPorTipo(true, undefined)).toEqual({ facetasPorTipo: true, caracteristicas: [] });
    expect(filtrosPorTipo(true, "polos:2")).toEqual({ facetasPorTipo: true, caracteristicas: ["polos:2"] });
    expect(filtrosPorTipo(true, ["curva:c", " polos:2 ", "basura", ""])).toEqual({
      facetasPorTipo: true,
      caracteristicas: ["polos:2", "curva:c"],
    });
  });
});

describe("corriente: rango de regulación en ?car=", () => {
  it("corriente_a:4-6 es un valor de lista (no un rango de slider) y su chip dice 4–6 A", () => {
    expect(leerIdCar("corriente_a:4-6")).toEqual({ clave: "corriente_a", op: "valor", valor: "4-6" });
    expect(leerIdCar("corriente_a:1.6-2.5")).toEqual({ clave: "corriente_a", op: "valor", valor: "1.6-2.5" });
    expect(etiquetaCar("corriente_a:4-6")).toBe("Corriente: 4–6 A");
    expect(etiquetaCar("corriente_a:6")).toBe("Corriente: 6 A");
    expect(leerIdCar("corriente_a:6-4")).toBeNull();
    expect(leerIdCar("polos:1-2")).toBeNull();
  });
});
