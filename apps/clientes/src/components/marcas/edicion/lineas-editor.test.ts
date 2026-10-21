import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categoriasDesconocidas } from "./SelectorCategoriasLinea";

/**
 * I1 e I2 de la revisión final. Las categorías de una línea se tipeaban a mano en un campo no
 * controlado dentro de una lista con claves por índice: al reordenar o borrar una línea, el campo
 * quedaba con las categorías de otra y las escribía al salir; y un nombre como se ve ("Iluminación")
 * no coincide con el guardado ("ILUMINACION"), así que la línea quedaba vacía sin aviso.
 */
describe("categorías de una línea", () => {
  it("el editor de líneas elige las categorías de la lista real, con un control controlado", () => {
    const src = readFileSync(join(__dirname, "editores.tsx"), "utf8");
    const editorLineas = src.slice(src.indexOf("function EditorLineas"), src.indexOf("function EditorElegidos"));
    expect(editorLineas).not.toMatch(/defaultValue=/);
    expect(editorLineas).toMatch(/<SelectorCategoriasLinea\b/);
  });

  it("marca las elegidas que ya no existen en el catálogo (por su nombre guardado, exacto)", () => {
    expect(categoriasDesconocidas(["ILUMINACION", "Exterior"], ["ILUMINACION", "HOGAR"])).toEqual(["Exterior"]);
    expect(categoriasDesconocidas([], ["Hogar"])).toEqual([]);
  });
});
