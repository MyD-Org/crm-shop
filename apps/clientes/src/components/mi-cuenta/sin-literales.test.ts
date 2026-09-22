import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda ESTÁTICA "nada hardcodeado" de Mi cuenta (NHM-1, decisión 1 del
 * rediseño extendida a Mi cuenta).
 *
 * Mi cuenta se arma sólo con componentes de `@myd-org/ui` y la escala
 * estándar de Tailwind para layout (`p-4`, `gap-6`, `md:w-64`, `text-sm`).
 * Color, radio, sombra y tipografía salen de los tokens del DS por ROL. Lo que
 * el DS no tenga se agrega al DS, no acá.
 *
 * Copia de la guarda del catálogo (`../catalogo/sin-literales.test.ts`, mismas
 * reglas y mismo `limpiar`) más dos reglas propias: registro formal (sin
 * voseo ni tuteo en el texto) y un único `<h1>`, el del shell. Unificar las
 * dos guardas en una sola es un chore aparte.
 *
 * Alcance (NHM-3): `src/components/mi-cuenta/**`, `src/app/mi-cuenta/**`,
 * `src/components/BotonFavorito.tsx` (rebanada de favoritos) y
 * `src/components/SelectorDireccionEnvio.tsx` (direcciones guardadas en el
 * checkout; el resto del checkout sigue afuera).
 * NO inspecciona `VincularClient.tsx`, `MenuUsuario.tsx`, `HeaderUI.tsx`,
 * `CheckoutClient.tsx`, `FacturacionForm.tsx` ni `DireccionAutocomplete.tsx`.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const CARPETAS = [join(SRC, "components", "mi-cuenta"), join(SRC, "app", "mi-cuenta")];
const SUELTOS_SI_EXISTEN = [
  join(SRC, "components", "BotonFavorito.tsx"),
  join(SRC, "components", "SelectorDireccionEnvio.tsx"),
];
/** Único archivo que puede tener el `<h1>` de Mi cuenta (ID-2). */
const SHELL = join(SRC, "components", "mi-cuenta", "MiCuentaShell.tsx");

/** `.tsx` de una carpeta, recursivo. Los tests no cuentan. */
function tsxRecursivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return tsxRecursivos(ruta);
    return nombre.endsWith(".tsx") ? [ruta] : [];
  });
}

function archivos(): string[] {
  return [
    ...CARPETAS.flatMap((c) => (existsSync(c) ? tsxRecursivos(c) : [])),
    ...SUELTOS_SI_EXISTEN.filter((f) => existsSync(f)),
  ];
}

const PALETA =
  "white|black|transparent|current|inherit|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** Reglas de estilo: cada una prohíbe una forma de hardcodear. */
export const REGLAS: { nombre: string; patrones: RegExp[] }[] = [
  {
    nombre: "1. valores arbitrarios de tamaño (`text-[15px]`, `md:grid-cols-[16rem_1fr]`)",
    patrones: [
      /\[\s*-?\d*\.?\d+(?:px|rem|em|vw|vh|%|ch|fr)\s*\]/,
      /\[\s*-?\d*\.?\d+(?:px|rem|em|vw|vh|%|ch|fr)_/,
    ],
  },
  { nombre: "2. clamp(", patrones: [/\bclamp\(/] },
  {
    nombre: "3. colores de la paleta de Tailwind (`text-white`, `border-amber-200`)",
    patrones: [
      new RegExp(
        `\\b(?:text|bg|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|accent|caret)-(?:${PALETA})(?:-\\d{2,3})?\\b`,
      ),
    ],
  },
  {
    nombre: "4. colores literales (hex, rgb(), hsl(), oklch(), color-mix())",
    patrones: [/#[0-9a-fA-F]{3,8}\b/, /\b(?:rgba?|hsla?|oklch|color-mix)\(/],
  },
  { nombre: "5. overrides sobre hijos del DS (`[&_h3]:…`)", patrones: [/\[&[\s_>:~+]/] },
  {
    nombre: "6. arbitrarios de radio/sombra/fuente/color (`rounded-[…]`, `-[var(--…)]`)",
    patrones: [/\b(?:rounded|shadow|font|text|bg|border)-\[/, /-\[var\(--/, /-\[(?:#|rgb|hsl)/],
  },
  { nombre: "7. estilos inline (`style={…}`)", patrones: [/\bstyle=\{/] },
  {
    nombre: "8. clases de componente armadas a mano (`const CELDA = \"… rounded …\"`)",
    patrones: [/\bconst\s+[A-Z_]{3,}\s*=\s*["'`][^"'`]*\b(?:h-\d|rounded|border)\b/],
  },
];

/** Registro formal de usted (CLAUDE.md, TRM-4): sin voseo ni tuteo. */
export const REGISTRO =
  /\b(?:tu|tus|te|vos|sos|probá|revisá|ingresá|vinculá|elegí|escribinos|podés|tenés|dale)\b/i;

/**
 * Lo que no cuenta: comentarios (documentar un `text-[15px]` viejo no es
 * usarlo) y las variantes de estado `data-[…]`/`aria-[…]`, que son selectores.
 * Conserva los saltos de línea para que los números de línea sigan valiendo.
 */
export function limpiar(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/(?:group-)?(?:data|aria)-\[[^\]]+\]/g, "");
}

/** Matches de unos patrones sobre el texto entero, como `línea: texto`. */
export function infracciones(texto: string, patrones: RegExp[]): string[] {
  const limpio = limpiar(texto);
  const lineas = limpio.split("\n");
  const numeros = new Set<number>();
  for (const p of patrones) {
    for (const m of limpio.matchAll(new RegExp(p.source, p.flags.replace("g", "") + "g"))) {
      numeros.add(limpio.slice(0, m.index).split("\n").length);
    }
  }
  return [...numeros].sort((a, b) => a - b).map((n) => `${n}: ${lineas[n - 1].trim()}`);
}

const estilo = (texto: string) => REGLAS.flatMap((r) => infracciones(texto, r.patrones));

describe("guarda de Mi cuenta: la guarda misma", () => {
  it("atrapa un color literal en style (reglas 4 y 7)", () => {
    const texto = '<p style={{ color: "#dc2626" }}>';
    expect(infracciones(texto, REGLAS[3].patrones)).not.toEqual([]);
    expect(infracciones(texto, REGLAS[6].patrones)).not.toEqual([]);
  });

  it("atrapa la grilla con ancho arbitrario (regla 1)", () => {
    expect(infracciones('className="grid gap-6 md:grid-cols-[16rem_1fr]"', REGLAS[0].patrones)).not.toEqual([]);
    expect(infracciones('className="-mt-[3px]"', REGLAS[0].patrones)).not.toEqual([]);
  });

  it("atrapa clamp, paleta, overrides, var() y constantes de clases", () => {
    expect(estilo('className="text-[clamp(30px,3vw,46px)]"')).not.toEqual([]);
    expect(estilo('className="border-amber-200 bg-amber-50 text-amber-800"')).not.toEqual([]);
    expect(estilo('className="[&_h3]:min-h-10"')).not.toEqual([]);
    expect(estilo('className="bg-[var(--color-x)]"')).not.toEqual([]);
    expect(estilo('const CELDA =\n  "inline-flex h-9 rounded-md border";')).toEqual(["1: const CELDA ="]);
  });

  it("deja pasar escala estándar, roles del DS, SVG, data-/aria- y comentarios", () => {
    expect(estilo('className="grid gap-6 md:w-64 text-sm text-muted bg-surface"')).toEqual([]);
    expect(estilo('<svg strokeWidth="1.6" viewBox="0 0 24 24" width="20">')).toEqual([]);
    expect(estilo('className="data-[state=open]:bg-elevated"')).toEqual([]);
    expect(estilo("// antes: text-[15px] y text-white")).toEqual([]);
    expect(estilo('const u = "https://crm.cliente.example/portal";')).toEqual([]);
  });

  it("registro: atrapa voseo y tuteo en el texto, no en comentarios", () => {
    expect(infracciones("<p>Revisá tus pedidos</p>", [REGISTRO])).not.toEqual([]);
    expect(infracciones("<p>Si ya sos cliente</p>", [REGISTRO])).not.toEqual([]);
    expect(infracciones("<p>Revise sus pedidos</p>", [REGISTRO])).toEqual([]);
    expect(infracciones("// antes decía: revisá tus pedidos", [REGISTRO])).toEqual([]);
    // "te" dentro de una palabra no cuenta.
    expect(infracciones("<p>Detalle de este pedido</p>", [REGISTRO])).toEqual([]);
  });
});

describe("guarda de Mi cuenta: archivos del módulo", () => {
  it("escanea componentes y páginas de Mi cuenta (la lista no puede quedar vacía)", () => {
    const lista = archivos().map((a) => relative(SRC, a));
    expect(lista.some((a) => a.startsWith(join("components", "mi-cuenta")))).toBe(true);
    expect(lista.some((a) => a.startsWith(join("app", "mi-cuenta")))).toBe(true);
    expect(lista).not.toContain(join("components", "VincularClient.tsx"));
  });

  it("incluye los archivos nuevos de direcciones de envío (follow-up direcciones-envio)", () => {
    const lista = archivos().map((a) => relative(SRC, a));
    expect(lista).toContain(join("components", "mi-cuenta", "DireccionesEnvio.tsx"));
    expect(lista).toContain(join("components", "mi-cuenta", "DireccionForm.tsx"));
    expect(lista).toContain(join("components", "mi-cuenta", "DatosPersonalesCard.tsx"));
    expect(lista).toContain(join("components", "SelectorDireccionEnvio.tsx"));
  });

  for (const regla of REGLAS) {
    it(`sin ${regla.nombre}`, () => {
      const encontrados = archivos().flatMap((ruta) =>
        infracciones(readFileSync(ruta, "utf8"), regla.patrones).map((m) => `${relative(SRC, ruta)}:${m}`),
      );
      expect(encontrados, encontrados.join("\n")).toEqual([]);
    });
  }

  it("registro formal de usted en todo el texto (TRM-4)", () => {
    const encontrados = archivos().flatMap((ruta) =>
      infracciones(readFileSync(ruta, "utf8"), [REGISTRO]).map((m) => `${relative(SRC, ruta)}:${m}`),
    );
    expect(encontrados, encontrados.join("\n")).toEqual([]);
  });

  it("un único <h1>, el del shell: las páginas usan <h2> (ID-2)", () => {
    const encontrados = archivos()
      .filter((ruta) => ruta !== SHELL)
      .flatMap((ruta) =>
        infracciones(readFileSync(ruta, "utf8"), [/<h1\b/]).map((m) => `${relative(SRC, ruta)}:${m}`),
      );
    expect(encontrados, encontrados.join("\n")).toEqual([]);
  });

  it("aviso (no bloquea): controles y cards a mano (NHM-2)", () => {
    const avisos = archivos().flatMap((ruta) =>
      infracciones(readFileSync(ruta, "utf8"), [/<button\b/, /rounded-xl border border-border bg-surface/]).map(
        (m) => `${relative(SRC, ruta)}:${m}`,
      ),
    );
    if (avisos.length > 0) {
      console.warn(`[mi-cuenta] controles o cards a mano, usar el DS:\n${avisos.join("\n")}`);
    }
    expect(true).toBe(true);
  });
});
