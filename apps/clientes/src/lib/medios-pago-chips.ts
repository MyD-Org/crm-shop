/**
 * Etiquetas ("chips") que el admin carga en cada medio de pago (`public.medios_pago_shop.chips`,
 * migración 0071 del CRM) y que el checkout muestra resaltadas sobre la opción del medio. Contrato
 * con el CRM: lista de `{ texto, tono }`, hasta 3, texto de 1 a 30 caracteres sin HTML, tono
 * `destacado` | `exito` | `info`. El CRM valida al escribir; acá se lee de forma TOLERANTE: lo que no
 * cumple se descarta y nunca rompe el checkout.
 */
import type { BadgeTone } from "@myd-org/ui";

export const MAX_CHIPS_MEDIO = 3;
const MAX_TEXTO = 30;

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
