/**
 * Decisión del tema por visitante (guía §5, opción A + C):
 *
 *   1. Override manual `?tema=azul|calido` (preview/QA) — persiste en cookie.
 *      `?tema=auto` borra la preferencia y vuelve a la geolocalización.
 *   2. Preferencia guardada en cookie (lo que decidió la primera visita).
 *   3. Geo-IP: Misiones (AR + región ISO "N") → "calido-azul" (azul de marca
 *      local); resto → "calido". Los headers los inyecta Vercel
 *      (x-vercel-ip-*); fuera de Vercel no vienen y el default es "calido".
 *
 * Hoy la geo-IP está APAGADA (GEO_IP_ACTIVO = false): todos ven el azul y la
 * cookie guardada no se consulta (las que dejó la geo decían "calido"). El
 * `?tema=` sigue funcionando para el request que lo trae. Para volver a
 * filtrar por IP, pasar el flag a true: el resto del código queda intacto.
 */

export const GEO_IP_ACTIVO = false;

export type Tema = "calido" | "calido-azul";
export type DecisionTema = Tema | "auto";

/** Tema de todos mientras la geo-IP está apagada. */
export const TEMA_POR_DEFECTO: Tema = "calido-azul";

export function resolverTema(input: {
  /** searchParams.get("tema") */
  consulta: string | null;
  /** Cookie guardada (puede venir inválida/vacía). */
  cookie: string | null | undefined;
  pais: string | null;
  region: string | null;
  /** Solo para tests: por defecto usa GEO_IP_ACTIVO. */
  geoActiva?: boolean;
}): DecisionTema {
  const q = (input.consulta ?? "").trim().toLowerCase();
  if (q === "azul") return "calido-azul";
  if (q === "calido") return "calido";
  if (q === "auto") return "auto";

  if (!(input.geoActiva ?? GEO_IP_ACTIVO)) return TEMA_POR_DEFECTO;

  const guardado = (input.cookie ?? "").trim();
  if (guardado === "calido" || guardado === "calido-azul") return guardado;

  if (input.pais === "AR" && input.region === "N") return "calido-azul";
  return "calido";
}

/** Nombre del header de país de Vercel (documentado en la plataforma). */
export const HEADER_PAIS = "x-vercel-ip-country";
export const HEADER_REGION = "x-vercel-ip-country-region";
/** Decisión del tema para ESTE request: la inyecta el proxy como header para
    que el layout la aplique de una (la cookie recién viaja en la response). */
export const HEADER_TEMA = "x-centralled-tema";
export const TEMA_COOKIE = "centralled-tema";
export const UN_ANIO = 60 * 60 * 24 * 365;
