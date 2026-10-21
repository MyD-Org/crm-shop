import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { razonDeContraste } from "@/lib/tema-tenant";

/**
 * Tema de la tienda oficial (`[data-tema-marca="oficial"]`, spec 2026-10-20 §6): las cards de
 * producto que caen adentro (los más elegidos, el bloque de la home) pintan stock y cuotas con los
 * roles de estado. Sobre el fondo oscuro tienen que llegar a AA (4,5:1) contra fondo y superficie.
 */
const css = readFileSync(join(__dirname, "globals.css"), "utf8");
const bloque = css.slice(css.indexOf('[data-tema-marca="oficial"] {'));
const token = (nombre: string) => bloque.match(new RegExp(`--color-${nombre}:\\s*(#[0-9a-f]{6})`))?.[1];

describe("tema de la tienda oficial", () => {
  for (const rol of ["text", "muted", "success", "danger", "warning", "info"]) {
    it(`${rol} llega a 4,5:1 sobre bg y surface`, () => {
      const color = token(rol);
      expect(color, `falta --color-${rol} en el tema oficial`).toBeTruthy();
      for (const fondo of [token("bg")!, token("surface")!]) {
        expect(razonDeContraste(color!, fondo)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
