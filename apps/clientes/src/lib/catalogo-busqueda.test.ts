import { describe, expect, it } from "vitest";
import { formasTermino, patronLike, raizPlural, terminosBusqueda } from "./catalogo-busqueda";

describe("terminosBusqueda", () => {
  it("parte por palabras: el orden en que se escriben no importa", () => {
    expect(terminosBusqueda("lampara led 9w")).toEqual(["lampara", "led", "9w"]);
  });

  it("minúsculas y sin tildes, igual que el SQL", () => {
    expect(terminosBusqueda("Lámpara TERMOMAGNÉTICO")).toEqual(["lampara", "termomagnetico"]);
  });

  it("descarta vacíos, repetidos y la puntuación de los bordes", () => {
    expect(terminosBusqueda('  "foco",  foco  (e27) ')).toEqual(["foco", "e27"]);
  });

  it("conserva la puntuación de adentro: los códigos la llevan", () => {
    expect(terminosBusqueda("TM-2x16 1.5mm")).toEqual(["tm-2x16", "1.5mm"]);
  });

  it("sin texto útil no hay términos", () => {
    expect(terminosBusqueda("  ,, ")).toEqual([]);
    expect(terminosBusqueda(undefined)).toEqual([]);
  });

  it("topea la cantidad de términos (cada uno es una condición en el SQL)", () => {
    const q = Array.from({ length: 20 }, (_, i) => `p${i}`).join(" ");
    expect(terminosBusqueda(q)).toHaveLength(8);
  });
});

describe("raizPlural", () => {
  it.each([
    ["lamparas", "lampara"],
    ["focos", "foco"],
    ["leds", "led"],
    ["interruptores", "interruptor"],
    ["tensiones", "tension"],
    ["luces", "luz"],
    ["cables", "cable"],
  ])("%s → %s", (plural, raiz) => {
    expect(raizPlural(plural)).toBe(raiz);
  });

  it("no toca singulares ni palabras cortas", () => {
    expect(raizPlural("lampara")).toBe("lampara");
    expect(raizPlural("gas")).toBe("gas");
    expect(raizPlural("mes")).toBe("mes");
  });

  it("no toca códigos ni medidas (llevan dígitos)", () => {
    expect(raizPlural("10mts")).toBe("10mts");
    expect(raizPlural("e27s")).toBe("e27s");
  });
});

describe("patronLike", () => {
  it("envuelve en % y escapa los comodines de LIKE", () => {
    expect(patronLike("led")).toBe("%led%");
    expect(patronLike("50%")).toBe("%50\\%%");
    expect(patronLike("a_b")).toBe("%a\\_b%");
    expect(patronLike("c:\\x")).toBe("%c:\\\\x%");
  });
});

describe("formasTermino", () => {
  it("busca el término tal cual y su singular, si difiere", () => {
    expect(formasTermino("luces")).toEqual(["luces", "luz"]);
    expect(formasTermino("lamparas")).toEqual(["lamparas", "lampara"]);
    expect(formasTermino("led")).toEqual(["led"]);
    expect(formasTermino("e27")).toEqual(["e27"]);
  });
});
