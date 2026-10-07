/**
 * Datos técnicos ESTRUCTURADOS de un producto (`public.catalog_atributos` del CRM, migración 0049, ampliada a 18 claves por la 0053;
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
  "corriente_a",
  "polos",
  "seccion_mm2",
  "medidas_mm",
  "color",
  "poder_corte_ka",
  "curva",
  "sensibilidad_ma",
  "largo_m",
  "montaje",
  "angulo_grados",
  "leds_m",
  "potencia_w_m",
  "leds_rollo",
  "diametro_mm",
  "ancho_mm",
] as const;
export type ClaveEstructurada = (typeof CLAVES_ESTRUCTURADAS)[number];

/**
 * Dónde vive el valor de cada clave: `num` = `valor_num`, `texto` = `valor_texto`. Se cruza con
 * `__fixtures__/atributos-claves.json` (contrato compartido con el CRM). `tension_v` y `corriente_a` son
 * numéricas y un rango viaja además en `t` (`CLAVES_CON_RANGO`).
 */
export const TIPO: Record<ClaveEstructurada, "num" | "texto"> = {
  potencia_w: "num",
  temperatura_k: "num",
  tono: "texto",
  ip: "num",
  flujo_lm: "num",
  tension_v: "num",
  zocalo: "texto",
  corriente_a: "num",
  polos: "num",
  seccion_mm2: "num",
  medidas_mm: "texto",
  color: "texto",
  poder_corte_ka: "num",
  curva: "texto",
  sensibilidad_ma: "num",
  largo_m: "num",
  montaje: "texto",
  angulo_grados: "num",
  leds_m: "num",
  potencia_w_m: "num",
  leds_rollo: "num",
  diametro_mm: "num",
  ancho_mm: "num",
};

/**
 * Claves numéricas cuyo `valor_texto` puede traer un RANGO "a-b" (con decimales de punto): la tensión de entrada
 * de un driver ("85-265", `valor_num` = 220 si lo incluye) y el rango de regulación de un relé térmico o un
 * guardamotor ("4-6", "1.6-2.5", `valor_num` = el tope). Convención del CRM (`normalizarAtributos`).
 */
export const CLAVES_CON_RANGO: readonly ClaveEstructurada[] = ["tension_v", "corriente_a"];

/** Rango "a-b" de `valor_texto` (a < b, punto decimal), o null si el texto no es un rango. */
const RE_RANGO = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;
export function leerRango(t: string | null | undefined): [number, number] | null {
  const m = t ? RE_RANGO.exec(t) : null;
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a < b ? [a, b] : null;
}

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

export const ETIQUETA: Record<ClaveEstructurada, string> = {
  potencia_w: "Potencia",
  temperatura_k: "Temperatura de color",
  tono: "Tipo de luz",
  ip: "Protección",
  flujo_lm: "Flujo luminoso",
  tension_v: "Tensión",
  zocalo: "Base / zócalo",
  corriente_a: "Corriente",
  polos: "Polos",
  seccion_mm2: "Sección",
  medidas_mm: "Medidas",
  color: "Color del producto",
  poder_corte_ka: "Poder de corte",
  curva: "Curva",
  sensibilidad_ma: "Sensibilidad",
  largo_m: "Largo",
  montaje: "Montaje",
  angulo_grados: "Ángulo",
  leds_m: "LED por metro",
  potencia_w_m: "Potencia por metro",
  leds_rollo: "LED por rollo",
  diametro_mm: "Diámetro",
  ancho_mm: "Ancho",
};

/** Tipo de luz (clave `tono`): blanca, de color o RGB. Mismo vocabulario que el CRM. */
const TONO: Record<string, string> = {
  calido: "Cálida",
  neutro: "Neutra",
  frio: "Fría",
  rojo: "Roja",
  verde: "Verde",
  azul: "Azul",
  amarillo: "Amarilla",
  naranja: "Naranja",
  ambar: "Ámbar",
  violeta: "Violeta",
  rosa: "Rosa",
  rgb: "RGB",
  rgbw: "RGBW",
};

/** Vocabulario cerrado de color y montaje (el mismo del CRM); lo que no está acá se omite. */
const COLOR: Record<string, string> = {
  blanco: "Blanco",
  negro: "Negro",
  gris: "Gris",
  rojo: "Rojo",
  azul: "Azul",
  verde: "Verde",
  amarillo: "Amarillo",
  marron: "Marrón",
  naranja: "Naranja",
  transparente: "Transparente",
  plateado: "Plateado",
  dorado: "Dorado",
};
const MONTAJE: Record<string, string> = {
  embutir: "De embutir",
  aplicar: "De aplicar",
  colgante: "Colgante",
  riel: "Para riel",
  din: "Riel DIN",
};
const MEDIDAS = /^\d+(\.\d+)?(x\d+(\.\d+)?){1,2}$/;

const num = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
/** Dos decimales: 0,75 mm² no puede redondearse a "0,8". */
const num2 = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

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
    case "corriente_a": {
      // Rango de regulación (relé térmico, guardamotor): "4–6 A", nunca el tope solo (se confundiría con una térmica de 6 A).
      const r = leerRango(v.t);
      if (r) return `${num2(r[0])}–${num2(r[1])} A`;
      return v.n != null ? `${num2(v.n)} A` : null;
    }
    case "polos":
      if (v.n == null || !Number.isInteger(v.n) || v.n < 1 || v.n > 4) return null;
      return v.n === 1 ? "1 polo" : `${v.n} polos`;
    case "seccion_mm2":
      return v.n != null ? `${num2(v.n)} mm²` : null;
    case "medidas_mm":
      if (!v.t || !MEDIDAS.test(v.t)) return null;
      return `${v.t.split("x").map((d) => Number(d).toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false })).join(" x ")} mm`;
    case "color":
      return v.t ? (COLOR[v.t] ?? null) : null;
    case "poder_corte_ka":
      return v.n != null ? `${num2(v.n)} kA` : null;
    case "curva":
      return v.t && /^[bcd]$/i.test(v.t) ? v.t.toUpperCase() : null;
    case "sensibilidad_ma":
      return v.n != null ? `${num2(v.n)} mA` : null;
    case "largo_m":
      return v.n != null ? `${num2(v.n)} m` : null;
    case "montaje":
      return v.t ? (MONTAJE[v.t] ?? null) : null;
    case "angulo_grados":
      return v.n != null ? `${num2(v.n)}°` : null;
    case "leds_m":
      return v.n != null ? `${num2(v.n)} LED/m` : null;
    case "potencia_w_m":
      return v.n != null ? `${num2(v.n)} W/m` : null;
    case "leds_rollo":
      return v.n != null ? `${num2(v.n)} LED por rollo` : null;
    case "diametro_mm":
      return v.n != null ? `${num2(v.n)} mm` : null;
    case "ancho_mm":
      return v.n != null ? `${num2(v.n)} mm` : null;
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
 * texto para las categóricas y para un rango de tensión ("85-265") o de regulación de corriente ("4-6").
 */
export function atributosParaAgente(a: AtributosEstructurados | undefined): Record<string, number | string> | undefined {
  if (!a) return undefined;
  const out: Record<string, number | string> = {};
  for (const c of CLAVES_ESTRUCTURADAS) {
    const v = a[c];
    if (!v) continue;
    // Sólo se informa lo que el Shop sabe mostrar: un valor fuera de vocabulario no llega al modelo.
    if (formatoValor(c, v) == null) continue;
    const rango = c === "tension_v" ? Boolean(v.t) : CLAVES_CON_RANGO.includes(c) && leerRango(v.t) !== null;
    const valor = TIPO[c] === "texto" || rango ? v.t : v.n;
    if (valor != null) out[c] = valor;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Prioridad de los chips de la card `spec`: las cinco de siempre primero (los casos existentes no
 * cambian) y después las eléctricas/dimensionales. Color, curva y montaje no son chips: se leen en
 * la ficha; el tono y el zócalo ya salen como atributos del diccionario ("Luz cálida", "Rosca E27").
 * Diámetro y ancho tampoco: "25 mm" suelto no dice de qué es; se leen en la tabla de la ficha y en el filtro.
 */
const CLAVES_CHIP = [
  "potencia_w",
  "temperatura_k",
  "flujo_lm",
  "ip",
  "tension_v",
  "corriente_a",
  "polos",
  "seccion_mm2",
  "medidas_mm",
  "poder_corte_ka",
  "sensibilidad_ma",
  "largo_m",
  "angulo_grados",
  "leds_m",
  "potencia_w_m",
  "leds_rollo",
] as const;
const TOPE_CHIPS = 6;

/**
 * Valores para la card `spec` del chat (`attributes`, lista de textos): "50 W", "3000 K",
 * "1020 lm", "IP65", "220 V", "16 A", "2 polos". Hasta 6, en el orden de prioridad.
 */
export function etiquetasTecnicas(a: AtributosEstructurados | undefined): string[] {
  if (!a) return [];
  return CLAVES_CHIP.flatMap((c) => {
    const v = formatoValor(c, a[c]);
    return v ? [v] : [];
  }).slice(0, TOPE_CHIPS);
}
