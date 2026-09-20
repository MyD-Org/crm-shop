/**
 * Decisión del tema por visitante (guía §5, opción A + C):
 *
 *   1. Override manual `?tema=azul|calido` (preview/QA) — persiste en cookie.
 *      `?tema=auto` borra la preferencia y vuelve a la geolocalización.
 *   2. Preferencia guardada en cookie (lo que decidió la primera visita).
 *   3. Geo-IP: Misiones (AR + región ISO "N") → "calido-azul" (azul de marca
 *      local); resto → "calido". Los headers los inyecta Vercel
 *      (x-vercel-ip-*); fuera de Vercel no vienen y el default es "calido".
 */

export type Tema = "calido" | "calido-azul";
export type DecisionTema = Tema | "auto";

export function resolverTema(input: {
  /** searchParams.get("tema") */
  consulta: string | null;
  /** Cookie guardada (puede venir inválida/vacía). */
  cookie: string | null | undefined;
  pais: string | null;
  region: string | null;
}): DecisionTema {
  const q = (input.consulta ?? "").trim().toLowerCase();
  if (q === "azul") return "calido-azul";
  if (q === "calido") return "calido";
  if (q === "auto") return "auto";

  const guardado = (input.cookie ?? "").trim();
  if (guardado === "calido" || guardado === "calido-azul") return guardado;

  if (input.pais === "AR" && input.region === "N") return "calido-azul";
  return "calido";
}

/** Nombre del header de país de Vercel (documentado en la plataforma). */
export const HEADER_PAIS = "x-vercel-ip-country";
export const HEADER_REGION = "x-vercel-ip-country-region";
export const TEMA_COOKIE = "centralled-tema";
export const UN_ANIO = 60 * 60 * 24 * 365;
