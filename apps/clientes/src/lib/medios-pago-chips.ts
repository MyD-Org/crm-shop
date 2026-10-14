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

/** Franja de ahorro de la transferencia cuando el admin no cargó una etiqueta de ahorro propia. */
export const TEXTO_AHORRO_POR_DEFECTO = "Ahorra {ahorro} frente a {frente}";

/** El texto de la etiqueta de ahorro con los montos y el nombre reemplazados. */
export function textoDeAhorro(texto: string, ahorro: string, frente: string): string {
  return texto.replaceAll("{ahorro}", ahorro).replaceAll("{frente}", frente);
}
