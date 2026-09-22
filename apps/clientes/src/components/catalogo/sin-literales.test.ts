import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda ESTÁTICA "nada hardcodeado" del catálogo (decisión 1 del rediseño).
 *
 * El catálogo se arma sólo con componentes de `@myd-org/ui` y la escala
 * estándar de Tailwind para layout (`p-4`, `gap-5`, `text-sm`, `lg:`…). Color,
 * radio, sombra y tipografía salen de los tokens del DS por ROL (`text-muted`,
 * `bg-surface`, `font-display`). Lo que el DS no tenga se agrega al DS, no acá.
 *
 * Lee los archivos como texto (mismo patrón que src/db/baseline.test.ts): el
 * Shop no tiene jsdom y esto no necesita renderizar nada. Cada regla es un
 * `it()` propio y el mensaje lista `archivo:línea: texto` de cada match.
 *
 * Alcance deliberado: `src/components/catalogo/**`, `CatalogoClient.tsx` y
 * `AddToCartButton.tsx`. No inspecciona `SearchAutocomplete.tsx` ni
 * `ProductoClient.tsx` (fuera de este cambio).
 */

const COMPONENTES = fileURLToPath(new URL("..", import.meta.url));
const CARPETA_CATALOGO = join(COMPONENTES, "catalogo");
const SUELTOS = ["CatalogoClient.tsx", "AddToCartButton.tsx"].map((f) =>
  join(COMPONENTES, f)
);

/** `.tsx` de la carpeta del catálogo, recursivo. Los tests no cuentan. */
function tsxRecursivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return tsxRecursivos(ruta);
    return nombre.endsWith(".tsx") ? [ruta] : [];
  });
}

const PALETA =
  "white|black|transparent|current|inherit|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** Reglas: cada una prohíbe una forma de hardcodear estilo. */
export const REGLAS: { nombre: string; patrones: RegExp[] }[] = [
  {
    nombre: "valores arbitrarios de tamaño (`text-[15px]`, `min-h-[2.5rem]`)",
    patrones: [/\[\s*-?\d*\.?\d+(?:px|rem|em|vw|vh|%|ch|fr)\s*\]/],
  },
  { nombre: "clamp(", patrones: [/\bclamp\(/] },
  {
    nombre: "colores de la paleta de Tailwind (`text-white`, `bg-gray-100`)",
    patrones: [
      new RegExp(
        `\\b(?:text|bg|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|accent|caret)-(?:${PALETA})(?:-\\d{2,3})?\\b`
      ),
    ],
  },
  {
    nombre: "colores literales (hex, rgb(), hsl(), oklch(), color-mix())",
    patrones: [/#[0-9a-fA-F]{3,8}\b/, /\b(?:rgba?|hsla?|oklch|color-mix)\(/],
  },
  {
    nombre: "overrides sobre hijos del DS (`[&_h3]:…`)",
    patrones: [/\[&[\s_>:~+]/],
  },
  {
    nombre: "arbitrarios de radio/sombra/fuente/color (`rounded-[…]`)",
    patrones: [/\b(?:rounded|shadow|font|text|bg|border)-\[/],
  },
  { nombre: "estilos inline (`style={…}`)", patrones: [/\bstyle=\{/] },
  {
    nombre: "clases de componente armadas a mano (`const CELDA = \"… rounded …\"`)",
    patrones: [
      /\bconst\s+[A-Z_]{3,}\s*=\s*["'`][^"'`]*\b(?:h-\d|rounded|border)\b/,
    ],
  },
];

/**
 * Lo que no cuenta como literal: comentarios (documentar un `text-[15px]`
 * viejo no es usarlo) y las variantes de estado `data-[…]`/`aria-[…]`, que
 * son selectores, no valores. Conserva los saltos de línea para que los
 * números de línea del reporte sigan siendo los del archivo.
 */
export function limpiar(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/(?:group-)?(?:data|aria)-\[[^\]]+\]/g, "");
}

/**
 * Matches de una regla en un texto, como `línea: texto`. Busca sobre el texto
 * entero y no línea por línea: `const CELDA =\n  "… rounded …"` parte la
 * declaración en dos líneas y igual tiene que caer.
 */
export function infracciones(texto: string, patrones: RegExp[]): string[] {
  const limpio = limpiar(texto);
  const lineas = limpio.split("\n");
  const numeros = new Set<number>();
  for (const p of patrones) {
    for (const m of limpio.matchAll(new RegExp(p.source, p.flags + "g"))) {
      numeros.add(limpio.slice(0, m.index).split("\n").length);
    }
  }
  return [...numeros]
    .sort((a, b) => a - b)
    .map((n) => `${n}: ${lineas[n - 1].trim()}`);
}

const todas = (texto: string) =>
  REGLAS.flatMap((r) => infracciones(texto, r.patrones));

describe("guarda anti-literales: la guarda misma", () => {
  it("atrapa un tamaño arbitrario", () => {
    expect(todas('<p className="text-[15px]">')).not.toEqual([]);
  });

  it("atrapa clamp, colores literales, overrides y constantes de clases", () => {
    expect(todas('className="text-[clamp(30px,3vw,46px)]"')).not.toEqual([]);
    expect(todas('className="hover:text-white"')).not.toEqual([]);
    expect(todas('className="bg-gray-100"')).not.toEqual([]);
    expect(todas('fill="#ff0000"')).not.toEqual([]);
    expect(todas('className="[&_h3]:min-h-10"')).not.toEqual([]);
    expect(todas("<div style={{ color: 'red' }}>")).not.toEqual([]);
    expect(todas('const CELDA = "inline-flex h-9 rounded-md border";')).not.toEqual([]);
    expect(todas('const CELDA =\n  "inline-flex h-9 rounded-md border";')).toEqual([
      '1: const CELDA =',
    ]);
  });

  it("deja pasar escala estándar, roles del DS y opacidad sobre un rol", () => {
    expect(
      todas(
        'className="grid grid-cols-2 gap-5 p-4 text-sm lg:grid-cols-4 rounded-lg shadow-1 bg-surface text-on-primary text-muted/30"'
      )
    ).toEqual([]);
  });

  it("deja pasar atributos SVG, variantes data-/aria- y comentarios", () => {
    expect(todas('<svg strokeWidth="2.5" viewBox="0 0 24 24" width="16">')).toEqual([]);
    expect(todas('className="data-[state=open]:bg-elevated"')).toEqual([]);
    expect(todas("// antes: text-[15px] y text-white")).toEqual([]);
    expect(todas("{/* antes: [&_h3]:min-h-[2.5rem] */}")).toEqual([]);
  });

  it("no confunde una URL con un comentario", () => {
    expect(todas('const u = "https://x.example/a"; <p className="text-white">')).not.toEqual([]);
  });
});

describe("guarda anti-literales: archivos del catálogo", () => {
  it("la carpeta src/components/catalogo existe y tiene componentes", () => {
    expect(existsSync(CARPETA_CATALOGO)).toBe(true);
    expect(tsxRecursivos(CARPETA_CATALOGO).length).toBeGreaterThan(0);
  });

  const archivos = () => [
    ...(existsSync(CARPETA_CATALOGO) ? tsxRecursivos(CARPETA_CATALOGO) : []),
    ...SUELTOS,
  ];

  for (const regla of REGLAS) {
    it(`sin ${regla.nombre}`, () => {
      const encontrados = archivos().flatMap((ruta) =>
        infracciones(readFileSync(ruta, "utf8"), regla.patrones).map(
          (m) => `${relative(COMPONENTES, ruta)}:${m}`
        )
      );
      expect(encontrados, encontrados.join("\n")).toEqual([]);
    });
  }
});
