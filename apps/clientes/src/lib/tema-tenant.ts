/**
 * Tema de la tienda (`tenants.shop_tema`, 0086 del CRM). PURO: lo usan el layout, el manifest y la
 * imagen OG; la lectura de la base está en `tema-tenant-datos.ts`.
 *
 * Mecanismo: el mismo que `globals.css` (redefinir los `--color-*` que consume el DS). Con paleta
 * propia se emite UNA regla `:root[data-theme][data-tema="propio"]{…}` (especificidad 0,3,0, mayor
 * que la de los bloques `[data-theme="calido-azul"]`, sin depender del orden del CSS). Sin paleta
 * propia (Central) no se emite ni el `<style>` ni el atributo: el HTML es el de siempre.
 *
 * Seguridad: el CSS se arma SOLO con colores que pasaron `/^#[0-9a-f]{6}$/`; nada de texto libre.
 * Contrato con el admin: `__fixtures__/tema-contrato.json` (copia del de apps/admin). El Shop es
 * tolerante: una fila tocada a mano (formato o contraste inválidos) no rompe el sitio, la paleta
 * propia se descarta entera y queda el tema de la base.
 */

export type BaseTema = "calido-azul" | "calido";

/** Es `TEMA_POR_DEFECTO` de tema-ip.ts: el azul que hoy ve todo el mundo. */
export const BASE_TEMA_POR_DEFECTO: BaseTema = "calido-azul";

export const CLAVES_COLOR = ["bg", "surface", "text", "muted", "primary", "onPrimary", "accent", "surfaceDark"] as const;
export type ColorTema = (typeof CLAVES_COLOR)[number];
export type ColoresTema = Record<ColorTema, string>;

export interface TemaTenant {
  base: BaseTema;
  /** Los 8 colores (todo o nada) o null = sin paleta propia. */
  colores: ColoresTema | null;
}

const HEX = /^#[0-9a-f]{6}$/;

/** AA para texto normal (igual que el admin). */
const UMBRAL_CONTRASTE = 4.5;
/** Parte de blanco que se le mezcla al acento para leerse sobre el pie oscuro (igual que el admin). */
const MEZCLA_MARCA_SOBRE_OSCURO = 0.35;

function canales(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminancia(hex: string): number {
  const [r, g, b] = canales(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores `#rrggbb` (1 a 21). */
export function razonDeContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Acento aclarado para leerse sobre el pie oscuro: mezcla lineal en sRGB con blanco. */
export function marcaSobreOscuro(accent: string): string {
  const mezclado = canales(accent).map((c) => Math.round(c + (255 - c) * MEZCLA_MARCA_SOBRE_OSCURO));
  return `#${mezclado.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Los pares que el Shop pinta con texto real (los mismos que valida el admin al guardar). */
function contrasteAlcanza(c: ColoresTema): boolean {
  return (
    razonDeContraste(c.text, c.bg) >= UMBRAL_CONTRASTE &&
    razonDeContraste(c.onPrimary, c.primary) >= UMBRAL_CONTRASTE &&
    razonDeContraste(c.accent, c.surface) >= UMBRAL_CONTRASTE &&
    razonDeContraste(marcaSobreOscuro(c.accent), c.surfaceDark) >= UMBRAL_CONTRASTE
  );
}

function sanearColores(raw: unknown): ColoresTema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const salida = {} as ColoresTema;
  for (const clave of CLAVES_COLOR) {
    const v = o[clave];
    if (typeof v !== "string") return null;
    const hex = v.trim().toLowerCase();
    if (!HEX.test(hex)) return null;
    salida[clave] = hex;
  }
  return contrasteAlcanza(salida) ? salida : null;
}

/** Normaliza lo que haya en la columna; nunca lanza. */
export function sanearTemaTenant(raw: unknown): TemaTenant {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { base: BASE_TEMA_POR_DEFECTO, colores: null };
  }
  const o = raw as Record<string, unknown>;
  const base: BaseTema = o.base === "calido" || o.base === "calido-azul" ? o.base : BASE_TEMA_POR_DEFECTO;
  return { base, colores: sanearColores(o.colores) };
}

/** Cuánto se oscurece/aclara el primario al pasar el mouse. */
const HOVER_PRIMARIO = 15;

/**
 * La regla de la paleta propia, o null si no hay (Central). Los tokens que el admin no pide se
 * derivan con `color-mix`; los semánticos (success/danger/warning), las fuentes y los radios quedan
 * como los define la base.
 */
export function cssTemaTenant(raw: unknown): string | null {
  const { colores: c } = sanearTemaTenant(raw);
  if (!c) return null;
  // El hover se aleja del color del texto de botón: claro sobre oscuro oscurece, y al revés.
  const hacia = luminancia(c.onPrimary) > luminancia(c.primary) ? "black" : "white";
  const declaraciones = [
    `--color-bg:${c.bg}`,
    `--color-surface:${c.surface}`,
    `--color-text:${c.text}`,
    `--color-muted:${c.muted}`,
    `--color-subtle:${c.muted}`,
    `--color-primary:${c.primary}`,
    `--color-on-primary:${c.onPrimary}`,
    `--color-accent:${c.accent}`,
    `--color-accent-strong:${c.accent}`,
    `--color-surface-dark:${c.surfaceDark}`,
    `--color-surface-darker:${c.primary}`,
    `--color-on-surface-dark:color-mix(in srgb, white 92%, ${c.surfaceDark})`,
    `--color-elevated:color-mix(in srgb, ${c.bg} 94%, ${c.text})`,
    `--color-border:color-mix(in srgb, ${c.text} 10%, transparent)`,
    `--color-border-strong:color-mix(in srgb, ${c.text} 26%, transparent)`,
    `--color-ring:${c.accent}`,
    `--color-primary-hover:color-mix(in srgb, ${c.primary} ${100 - HOVER_PRIMARIO}%, ${hacia})`,
    `--color-primary-soft:color-mix(in srgb, ${c.accent} 12%, ${c.surface})`,
    `--color-accent-soft:color-mix(in srgb, ${c.accent} 12%, ${c.surface})`,
    `--color-info:${c.accent}`,
    `--color-info-soft:color-mix(in srgb, ${c.accent} 12%, ${c.surface})`,
    `--color-marca-sobre-oscuro:color-mix(in srgb, ${c.accent} 65%, white)`,
    `--color-highlight:var(--color-marca-sobre-oscuro)`,
  ];
  return `:root[data-theme][data-tema="propio"]{${declaraciones.join(";")};}`;
}

export interface AtributosHtmlTema {
  dataTheme: BaseTema;
  /** "propio" sólo con paleta propia; undefined = React no emite el atributo. */
  dataTema: "propio" | undefined;
  css: string | null;
}

/** Lo que el layout pone en `<html>` y en el `<head>`. */
export function atributosHtmlTema(raw: unknown): AtributosHtmlTema {
  const t = sanearTemaTenant(raw);
  const css = cssTemaTenant(raw);
  return { dataTheme: t.base, dataTema: css ? "propio" : undefined, css };
}

export interface ColoresPwa {
  fondo: string;
  tema: string;
  tinta: string;
  suave: string;
  acento: string;
}

/** Colores para el manifest (fondo/tema) y la imagen OG; null = los de Central, como hoy. */
export function coloresPwaDeTema(raw: unknown): ColoresPwa | null {
  const { colores: c } = sanearTemaTenant(raw);
  if (!c) return null;
  return { fondo: c.bg, tema: c.primary, tinta: c.text, suave: c.muted, acento: c.accent };
}
