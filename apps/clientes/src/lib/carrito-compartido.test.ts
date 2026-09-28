import { describe, expect, it } from "vitest";
import {
  accionAlCompartir,
  codificarCompartido,
  hrefCompartido,
  parsearCompartido,
  separarDisponibles,
} from "./carrito-compartido";
import { MAX_ENTRADAS_BODY, MAX_LINEAS, QTY_MAX, type CartItem } from "./carrito-cliente";

const item = (id: string, qty: number, extra: Partial<CartItem> = {}): CartItem => ({
  id,
  qty,
  name: `P${id}`,
  brand: "",
  price: 100,
  ...extra,
});

describe("codificar / parsear", () => {
  it("ida y vuelta conserva ids, cantidades y orden", () => {
    const lineas = [
      { id: "12", qty: 3 },
      { id: "5", qty: 1 },
    ];
    expect(codificarCompartido(lineas)).toBe("12:3,5:1");
    expect(parsearCompartido(codificarCompartido(lineas))).toEqual(lineas);
  });

  it("sólo viajan id y qty aunque el ítem traiga más campos", () => {
    expect(codificarCompartido([item("7", 2)])).toBe("7:2");
  });

  it("hrefCompartido arma la ruta de la preview", () => {
    expect(hrefCompartido([{ id: "7", qty: 2 }])).toBe("/carrito/compartido?i=7:2");
  });

  it.each([null, undefined, "", "   ", "abc", "a:b", ":", ","])("basura %j → vacío", (raw) => {
    expect(parsearCompartido(raw)).toEqual([]);
  });

  it("descarta los pares inválidos y se queda con los válidos", () => {
    // Link truncado por el chat, negativos, decimales, ids no numéricos.
    expect(parsearCompartido("12:3,1:-2,2:1.5,x:1,3:0,45:,9:2")).toEqual([
      { id: "12", qty: 3 },
      { id: "9", qty: 2 },
    ]);
  });

  it("rechaza ids más largos que los de Alegra", () => {
    expect(parsearCompartido(`${"1".repeat(65)}:1`)).toEqual([]);
    expect(parsearCompartido(`${"1".repeat(64)}:1`)).toHaveLength(1);
  });

  it("tolera espacios alrededor de los pares", () => {
    expect(parsearCompartido(" 12:3 , 5:1 ")).toEqual([
      { id: "12", qty: 3 },
      { id: "5", qty: 1 },
    ]);
  });

  it("los ids repetidos suman", () => {
    expect(parsearCompartido("12:1,12:2")).toEqual([{ id: "12", qty: 3 }]);
  });

  it("aplica QTY_MAX", () => {
    expect(parsearCompartido(`12:${QTY_MAX + 50}`)).toEqual([{ id: "12", qty: QTY_MAX }]);
  });

  it("recorta a MAX_LINEAS", () => {
    const raw = Array.from({ length: MAX_LINEAS + 5 }, (_, i) => `${i + 1}:1`).join(",");
    expect(parsearCompartido(raw)).toHaveLength(MAX_LINEAS);
  });

  it("ignora lo que pase de MAX_ENTRADAS_BODY pares (no procesa links enormes)", () => {
    // Los primeros MAX_ENTRADAS_BODY son el mismo id: los que siguen no se leen.
    const raw = [
      ...Array.from({ length: MAX_ENTRADAS_BODY }, () => "1:1"),
      "2:1",
    ].join(",");
    expect(parsearCompartido(raw)).toEqual([{ id: "1", qty: MAX_ENTRADAS_BODY }]);
  });
});

describe("accionAlCompartir", () => {
  const compartido = [
    { id: "1", qty: 2 },
    { id: "2", qty: 1 },
  ];

  it("carrito vacío → cargar sin preguntar", () => {
    expect(accionAlCompartir([], compartido)).toBe("cargar");
  });

  it("mismo contenido en otro orden → igual", () => {
    expect(
      accionAlCompartir(
        [
          { id: "2", qty: 1 },
          { id: "1", qty: 2 },
        ],
        compartido,
      ),
    ).toBe("igual");
  });

  it("contenido distinto → preguntar", () => {
    expect(accionAlCompartir([{ id: "1", qty: 1 }], compartido)).toBe("preguntar");
    expect(accionAlCompartir([{ id: "9", qty: 1 }], compartido)).toBe("preguntar");
  });
});

describe("separarDisponibles", () => {
  it("los faltantes y los sin precio van aparte, sin perder el orden", () => {
    const { disponibles, noDisponibles } = separarDisponibles([
      item("1", 1),
      item("2", 1, { faltante: true }),
      item("3", 1, { price: 0 }),
      item("4", 2),
    ]);
    expect(disponibles.map((i) => i.id)).toEqual(["1", "4"]);
    expect(noDisponibles.map((i) => i.id)).toEqual(["2", "3"]);
  });
});
