import { describe, expect, it } from "vitest";
import { esIdProducto, idDeRuta } from "./id-producto";

describe("esIdProducto", () => {
  it.each(["4521", "0", "mdp:12", "avantec:7", "central-led:9"])("acepta %j", (id) => {
    expect(esIdProducto(id)).toBe(true);
  });

  it.each([
    "",
    "mdp:",
    ":12",
    "MDP:1",
    "a:b",
    "a:1", // el slug tiene al menos 2 caracteres
    "1;drop",
    "mdp:12:3",
    "20:5", // el slug empieza con letra: nunca se confunde con id:qty
    "../x",
    "mdp:1 2",
    "mdp:12a",
    "abcdefghijklm:1", // slug de más de 12 caracteres
    `${"1".repeat(65)}`,
    `mdp:${"1".repeat(61)}`,
  ])("rechaza %j", (id) => {
    expect(esIdProducto(id)).toBe(false);
  });

  it("el largo máximo es 64", () => {
    expect(esIdProducto("1".repeat(64))).toBe(true);
    expect(esIdProducto(`mdp:${"1".repeat(60)}`)).toBe(true);
  });

  it.each([null, undefined, 12, {}, ["12"]])("rechaza no-string %j", (id) => {
    expect(esIdProducto(id)).toBe(false);
  });
});

describe("idDeRuta", () => {
  it("decodifica el segmento de ruta con ':' codificado", () => {
    expect(idDeRuta("mdp%3A12")).toBe("mdp:12");
    expect(esIdProducto(idDeRuta("mdp%3A12"))).toBe(true);
  });

  it("es idempotente con ids ya decodificados", () => {
    expect(idDeRuta("mdp:12")).toBe("mdp:12");
    expect(idDeRuta("4521")).toBe("4521");
  });

  it("no lanza con un escape inválido y el id resultante se rechaza", () => {
    expect(idDeRuta("%E0%A4%A")).toBe("%E0%A4%A");
    expect(esIdProducto(idDeRuta("%E0%A4%A"))).toBe(false);
    expect(esIdProducto(idDeRuta("..%2Fx"))).toBe(false);
  });
});
