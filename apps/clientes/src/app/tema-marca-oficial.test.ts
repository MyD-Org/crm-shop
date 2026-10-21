import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { razonDeContraste } from "@/lib/tema-tenant";

/**
 * Temas de la tienda oficial (spec 2026-10-20 §6): `[data-tema-marca="oficial"]` (oscuro, el de
 * siempre) y `[data-tema-marca="oficial"][data-tono="claro"]`. Las cards de producto que caen
 * adentro pintan stock y cuotas con los roles de estado: todo texto tiene que llegar a AA (4,5:1)
 * contra el fondo y la superficie de su tema, incluido el acento por defecto.
 */
const css = readFileSync(join(__dirname, "globals.css"), "utf8");
function bloque(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `falta ${selector} en globals.css`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
}
const token = (b: string, nombre: string) =>
  b.match(new RegExp(`--color-${nombre}:\\s*(?:var\\(--acento-marca,\\s*)?(#[0-9a-f]{6})`))?.[1];

const TEMAS = {
  oscuro: bloque('[data-tema-marca="oficial"]'),
  claro: bloque('[data-tema-marca="oficial"][data-tono="claro"]'),
};

describe.each(Object.entries(TEMAS))("tema %s de la tienda oficial", (_nombre, b) => {
  for (const rol of ["text", "muted", "accent", "success", "danger", "warning", "info"]) {
    it(`${rol} llega a 4,5:1 sobre bg y surface`, () => {
      const color = token(b, rol);
      expect(color, `falta --color-${rol}`).toBeTruthy();
      for (const fondo of [token(b, "bg")!, token(b, "surface")!]) {
        expect(razonDeContraste(color!, fondo)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
