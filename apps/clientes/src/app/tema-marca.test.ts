import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Led" del logo: un solo color de marca por tema. En el header es el acento;
 * en el footer (fondo oscuro) el mismo tono aclarado, porque el acento tal
 * cual no se lee sobre oscuro (azul: 2,2:1). Guarda estática sobre
 * globals.css, donde viven los tokens de cada tema.
 */
const css = readFileSync(join(__dirname, "globals.css"), "utf8");
const footer = readFileSync(join(__dirname, "..", "components", "SiteFooter.tsx"), "utf8");

function bloque(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `falta el bloque ${selector}`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("\n}", i));
}

function token(b: string, nombre: string): string {
  const m = b.match(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `falta --${nombre}`).not.toBeNull();
  return m![1];
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("marca del footer", () => {
  it.each(['[data-theme="calido"]', '[data-theme="calido-azul"]'])(
    "%s: la marca sobre oscuro se lee sobre el fondo del footer (≥ 4,5:1)",
    (tema) => {
      const b = bloque(tema);
      const marca = token(b, "color-marca-sobre-oscuro");
      const fondo = token(b, "color-surface-dark");
      expect(contraste(marca, fondo)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("el footer pinta su marca con ese token, sin itálica, como el header", () => {
    expect(footer).toContain('className="site-footer"');
    expect(css).toMatch(
      /\.site-footer em\s*\{[^}]*color:\s*var\(--color-marca-sobre-oscuro\);[^}]*font-style:\s*normal;/,
    );
  });

  it("el footer ya no usa overrides arbitrarios", () => {
    expect(footer).not.toContain("[&_");
  });
});
