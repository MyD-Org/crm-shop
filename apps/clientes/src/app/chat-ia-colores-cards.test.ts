import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Las cards de producto del chat (ai-widget ≥ 0.12.0) toman los colores de la card del catálogo
 * por tokens del DS: la línea "$ X con Transferencia" en acento y "Agregar" como el Button `soft`.
 * Guarda estática sobre globals.css: sin esto vuelven al primario del widget (gris y negro).
 */
const css = readFileSync(join(__dirname, "globals.css"), "utf8");
const i = css.indexOf(":root .aichat-root {");
const bloque = css.slice(i, css.indexOf("\n}", i));

describe("colores de las cards del chat", () => {
  it("apuntan a los tokens del DS, sin colores fijos", () => {
    expect(i).toBeGreaterThan(-1);
    expect(bloque).toContain("--aichat-price-note: var(--color-accent);");
    expect(bloque).toContain("--aichat-add-bg: var(--color-accent-soft);");
    expect(bloque).toContain("--aichat-add-text: var(--color-accent);");
    expect(bloque).toMatch(/--aichat-add-bg-hover: color-mix\(in oklab, var\(--color-accent\) 15%, transparent\);/);
  });
});
