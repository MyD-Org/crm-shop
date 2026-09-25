import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estática de contraste (WCAG 2.2) sobre los tokens de `globals.css`
 * que corrigió `fix/clientes-foco-y-contraste`:
 *   - --color-ring: era casi invisible (rgba con alpha bajo, ~1,2:1 contra
 *     bg/surface). El DS lo usa sólo para el ring de focus-visible (sin glow
 *     decorativo), así que exige ≥ 3:1 (1.4.11, indicador no textual).
 *   - --color-muted / --color-subtle: el DS los usa como texto (hint,
 *     subtítulos, separadores), exigen ≥ 4,5:1 contra bg y elevated.
 *   - --color-primary-hover: es el fondo del botón primario en hover con
 *     --color-on-primary encima; exige ≥ 4,5:1 igual que cualquier texto.
 * Si alguien vuelve a aclarar/oscurecer estos tokens sin mirar el contraste,
 * este test lo frena.
 */
const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function bloque(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `falta el bloque ${selector}`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("\n}", i));
}

function token(b: string, nombre: string): string {
  const m = b.match(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `falta --${nombre} (o no es un hex de 6 dígitos)`).not.toBeNull();
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

const TEMAS = ['[data-theme="calido"]', '[data-theme="calido-azul"]'];

describe("contraste de texto: --color-muted (≥ 4,5:1)", () => {
  it.each(TEMAS)("%s: muted contra bg y elevated", (tema) => {
    const b = bloque(tema);
    const muted = token(b, "color-muted");
    const bg = token(b, "color-bg");
    const elevated = token(b, "color-elevated");
    expect(contraste(muted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(muted, elevated)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contraste de texto: --color-subtle (≥ 4,5:1, el DS lo usa como texto)", () => {
  it.each(TEMAS)("%s: subtle contra bg y elevated", (tema) => {
    const b = bloque(tema);
    const subtle = token(b, "color-subtle");
    const bg = token(b, "color-bg");
    const elevated = token(b, "color-elevated");
    expect(contraste(subtle, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(subtle, elevated)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("anillo de foco: --color-ring (≥ 3:1, WCAG 1.4.11)", () => {
  it.each(TEMAS)("%s: ring contra bg y surface", (tema) => {
    const b = bloque(tema);
    const ring = token(b, "color-ring");
    const bg = token(b, "color-bg");
    const surface = token(b, "color-surface");
    expect(contraste(ring, bg)).toBeGreaterThanOrEqual(3);
    expect(contraste(ring, surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("botón primario en hover: --color-on-primary sobre --color-primary-hover (≥ 4,5:1)", () => {
  it.each(TEMAS)("%s", (tema) => {
    const b = bloque(tema);
    const onPrimary = token(b, "color-on-primary");
    const primaryHover = token(b, "color-primary-hover");
    expect(contraste(onPrimary, primaryHover)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("acento sobre fondo: --color-accent (≥ 3:1, texto de precios/links medianos)", () => {
  it.each(TEMAS)("%s", (tema) => {
    const b = bloque(tema);
    const accent = token(b, "color-accent");
    const bg = token(b, "color-bg");
    expect(contraste(accent, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("CuotasLinea tono=oscuro: --color-success-sobre-oscuro (≥ 4,5:1 contra el footer)", () => {
  it.each(TEMAS)("%s", (tema) => {
    const b = bloque(tema);
    const success = token(b, "color-success-sobre-oscuro");
    const surfaceDark = token(b, "color-surface-dark");
    expect(contraste(success, surfaceDark)).toBeGreaterThanOrEqual(4.5);
  });
});
