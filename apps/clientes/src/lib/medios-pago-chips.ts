/**
 * Etiquetas ("chips") que el admin carga en cada medio de pago (`public.medios_pago_shop.chips`,
 * migración 0071 del CRM) y que el checkout muestra resaltadas sobre la opción del medio. Contrato
 * con el CRM: lista de `{ texto, tono }`, hasta 3, texto de 1 a 40 caracteres sin HTML, tono
 * `destacado` | `exito` | `info`. El CRM valida al escribir; acá se lee de forma TOLERANTE: lo que no
 * cumple se descarta y nunca rompe el checkout.
 */
import type { BadgeTone } from "@myd-org/ui";

export const MAX_CHIPS_MEDIO = 3;
const MAX_TEXTO = 40;

export type TonoChip = "destacado" | "exito" | "info";

export interface ChipMedio {
  texto: string;
  tono: TonoChip;
}

const TONOS: readonly string[] = ["destacado", "exito", "info"];
// Sin HTML (< >) ni caracteres de control.
const PROHIBIDOS = /[<>\u0000-\u001f\u007f]/;

/** Normaliza lo que viene del jsonb de la base: [] si no es una lista; descarta lo mal formado. */
export function leerChipsMedio(valor: unknown): ChipMedio[] {
  if (!Array.isArray(valor)) return [];
  const chips: ChipMedio[] = [];
  for (const c of valor) {
    if (chips.length >= MAX_CHIPS_MEDIO) break;
    if (typeof c !== "object" || c === null || Array.isArray(c)) continue;
    const { texto, tono } = c as { texto?: unknown; tono?: unknown };
    if (typeof texto !== "string" || typeof tono !== "string" || !TONOS.includes(tono)) continue;
    const t = texto.trim();
    if (t === "" || t.length > MAX_TEXTO || PROHIBIDOS.test(t)) continue;
    chips.push({ texto: t, tono: tono as TonoChip });
  }
  return chips;
}

/** Tono del Badge del DS para cada tono de chip (el DS no tiene un tono de acento propio). */
export function tonoBadgeDeChip(tono: TonoChip): BadgeTone {
  return tono === "exito" ? "success" : tono === "info" ? "info" : "warning";
}

/**
 * Etiqueta de ahorro: su texto lleva `{ahorro}` (cuánto ahorra con el medio frente a la opción más
 * cara) y puede llevar `{frente}` (esa opción). No se dibuja como etiqueta sino como la franja de
 * ahorro de la card, y sólo cuando hay ahorro.
 */
export function esChipDeAhorro(c: Pick<ChipMedio, "texto">): boolean {
  return c.texto.includes("{ahorro}");
}

/** Banner de ahorro de la transferencia cuando el admin no guardó uno. */
export const TEXTO_AHORRO_POR_DEFECTO = "Ahorra {ahorro} frente a {frente}";

/**
 * Banner de ahorro del medio (la franja verde del checkout). El CRM lo guarda como un elemento más
 * de `chips` con `banner: true` (sin `tono`, así `leerChipsMedio` lo ignora): `activo` y `texto`, con
 * `{ahorro}` = monto y `{frente}` = la opción más cara. null = no hay guardado (Transferencia lo
 * muestra igual, con `TEXTO_AHORRO_POR_DEFECTO`).
 */
export interface BannerAhorro {
  activo: boolean;
  texto: string;
}

const MAX_TEXTO_BANNER = 80;

/** Lectura TOLERANTE del banner dentro de `chips`: lo mal formado es null. */
export function leerBannerMedio(valor: unknown): BannerAhorro | null {
  if (!Array.isArray(valor)) return null;
  const b = valor.find((c) => typeof c === "object" && c !== null && (c as { banner?: unknown }).banner === true) as
    | { activo?: unknown; texto?: unknown }
    | undefined;
  if (!b || typeof b.activo !== "boolean" || typeof b.texto !== "string") return null;
  const texto = b.texto.trim();
  if (texto === "" || texto.length > MAX_TEXTO_BANNER || PROHIBIDOS.test(texto)) return null;
  return { activo: b.activo, texto };
}

/**
 * Texto del banner de un medio, o null si no se muestra: el guardado (si está activo); si no hay, una
 * etiqueta vieja con {ahorro}; si tampoco, el de por defecto en Transferencia.
 */
export function textoBannerDelMedio(
  medio: { slug: string; banner?: BannerAhorro | null; chips?: readonly ChipMedio[] },
  slugTransferencia: string,
): string | null {
  if (medio.banner) return medio.banner.activo ? medio.banner.texto : null;
  return medio.chips?.find(esChipDeAhorro)?.texto ?? (medio.slug === slugTransferencia ? TEXTO_AHORRO_POR_DEFECTO : null);
}

/** El texto de la etiqueta de ahorro con los montos y el nombre reemplazados. */
export function textoDeAhorro(texto: string, ahorro: string, frente: string): string {
  return texto.replaceAll("{ahorro}", ahorro).replaceAll("{frente}", frente);
}
