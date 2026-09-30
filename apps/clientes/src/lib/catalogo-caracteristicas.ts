/**
 * Datos técnicos ESTRUCTURADOS de un producto (`public.catalog_atributos` del CRM, migración 0047;
 * contrato `crm-shop-base/v1`). El CRM los escribe desde el nombre, la ficha PDF o a mano, con
 * precedencia manual > pdf > nombre; el Shop sólo lee el valor que quedó.
 *
 * Módulo puro (sin DB ni React): lo usan el catálogo (filtros `?atr=` y `?potencia_*`), la ficha
 * del producto (tabla "Características") y el chat (card `spec` y `ProductoAgente`).
 */

export const CLAVES_ESTRUCTURADAS = [
  "potencia_w",
  "temperatura_k",
  "tono",
  "ip",
  "flujo_lm",
  "tension_v",
  "zocalo",
] as const;
export type ClaveEstructurada = (typeof CLAVES_ESTRUCTURADAS)[number];

/** Un valor tal como viaja en la consulta: `n` = valor_num, `t` = valor_texto. */
export interface ValorEstructurado {
  n: number | null;
  t: string | null;
}

/** Atributos estructurados de un producto, por clave. Ausente = sin dato. */
export type AtributosEstructurados = Partial<Record<ClaveEstructurada, ValorEstructurado>>;

const esClave = (c: string): c is ClaveEstructurada => (CLAVES_ESTRUCTURADAS as readonly string[]).includes(c);

/**
 * El jsonb de la consulta (`jsonb_object_agg(clave, {n, t})`) → objeto validado. Claves que el Shop
 * no conoce y valores vacíos se descartan; `null`/basura ⇒ `undefined`.
 */
export function leerAtributosEstructurados(crudo: unknown): AtributosEstructurados | undefined {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return undefined;
  const out: AtributosEstructurados = {};
  for (const [clave, v] of Object.entries(crudo as Record<string, unknown>)) {
    if (!esClave(clave) || !v || typeof v !== "object") continue;
    const { n, t } = v as { n?: unknown; t?: unknown };
    const num = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : null;
    const valor: ValorEstructurado = {
      n: num != null && Number.isFinite(num) ? num : null,
      t: typeof t === "string" && t.trim() !== "" ? t.trim() : null,
    };
    if (valor.n != null || valor.t != null) out[clave] = valor;
  }
  return Object.keys(out).length ? out : undefined;
}

const ETIQUETA: Record<ClaveEstructurada, string> = {
  potencia_w: "Potencia",
  temperatura_k: "Temperatura de color",
  tono: "Tono de luz",
  ip: "Protección",
  flujo_lm: "Flujo luminoso",
  tension_v: "Tensión",
  zocalo: "Base / zócalo",
};

const TONO: Record<string, string> = { calido: "Cálida", neutro: "Neutra", frio: "Fría" };

const num = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });

/** Valor legible de una clave ("50 W", "3000 K", "IP65", "85–265 V", "E27"). null si no hay. */
export function formatoValor(clave: ClaveEstructurada, v: ValorEstructurado | undefined): string | null {
  if (!v) return null;
  switch (clave) {
    case "potencia_w":
      return v.n != null ? `${num(v.n)} W` : null;
    case "temperatura_k":
      return v.n != null ? `${Math.round(v.n)} K` : null;
    case "flujo_lm":
      return v.n != null ? `${num(v.n)} lm` : null;
    case "ip":
      return v.n != null ? `IP${String(Math.trunc(v.n)).padStart(2, "0")}` : null;
    case "tension_v":
      if (v.t && /^\d+-\d+$/.test(v.t)) return `${v.t.replace("-", "–")} V`;
      if (v.t && /^\d+\/\d+$/.test(v.t)) return `${v.t} V`;
      return v.n != null ? `${num(v.n)} V` : null;
    case "tono":
      return v.t ? (TONO[v.t] ?? null) : null;
    case "zocalo":
      return v.t ? v.t.toUpperCase() : null;
  }
}

/** Filas de la tabla "Características" de la ficha, en el orden de las claves. */
export function caracteristicasDe(a: AtributosEstructurados | undefined): { etiqueta: string; valor: string }[] {
  if (!a) return [];
  return CLAVES_ESTRUCTURADAS.flatMap((c) => {
    const valor = formatoValor(c, a[c]);
    return valor ? [{ etiqueta: ETIQUETA[c], valor }] : [];
  });
}

/**
 * Forma compacta para el modelo del chat (`ProductoAgente.atributos`): número para las numéricas,
 * texto para las categóricas y para un rango de tensión ("85-265").
 */
export function atributosParaAgente(a: AtributosEstructurados | undefined): Record<string, number | string> | undefined {
  if (!a) return undefined;
  const out: Record<string, number | string> = {};
  for (const c of CLAVES_ESTRUCTURADAS) {
    const v = a[c];
    if (!v) continue;
    const valor = c === "tono" || c === "zocalo" || (c === "tension_v" && v.t) ? v.t : v.n;
    if (valor != null) out[c] = valor;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Valores numéricos para la card `spec` del chat (`attributes`, lista de textos): "50 W",
 * "3000 K", "1020 lm", "IP65", "220 V". El tono y el zócalo ya salen como atributos del
 * diccionario ("Luz cálida", "Rosca E27").
 */
export function etiquetasTecnicas(a: AtributosEstructurados | undefined): string[] {
  if (!a) return [];
  return (["potencia_w", "temperatura_k", "flujo_lm", "ip", "tension_v"] as const).flatMap((c) => {
    const v = formatoValor(c, a[c]);
    return v ? [v] : [];
  });
}
