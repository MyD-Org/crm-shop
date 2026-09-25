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
 * `?tema=` sigue funcionando para la página que lo trae.
 *
 * Con Cache Components el `<html>` sale del shell estático, igual para todos:
 * `data-theme` es TEMA_POR_DEFECTO y el `?tema=` lo aplica un script inline en
 * el `<head>` (`scriptTema`, antes del primer pintado). El proxy sólo escribe la
 * cookie cuando viene `?tema=`: una vista normal no lleva Set-Cookie y el shell
 * se puede servir desde la CDN.
 *
 * Volver a filtrar por IP NO es sólo pasar el flag a true: la decisión por
 * visitante no entra en un shell compartido. Haría falta, por ejemplo, que el
 * proxy reescriba a una variante del shell por tema, o leer la cookie en el
 * script (la primera visita seguiría viendo el default).
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
export const TEMA_COOKIE = "centralled-tema";
export const UN_ANIO = 60 * 60 * 24 * 365;

/**
 * Qué hace el proxy con la cookie del tema en una página. Sólo actúa si el
 * request trae `?tema=`: sin él no hay nada que persistir (con la geo apagada
 * la cookie ni se lee) y la respuesta sale sin Set-Cookie, cacheable.
 */
export function cookieDeTema(input: {
  /** El request trae `?tema=` (con cualquier valor). */
  forzada: boolean;
  decision: DecisionTema;
  /** Cookie actual del visitante. */
  previa: string | undefined;
}): { accion: "ninguna" } | { accion: "borrar" } | { accion: "guardar"; tema: Tema } {
  if (!input.forzada) return { accion: "ninguna" };
  if (input.decision === "auto") {
    return input.previa === undefined ? { accion: "ninguna" } : { accion: "borrar" };
  }
  return { accion: "guardar", tema: input.decision };
}

/**
 * Script inline del `<head>`: aplica `?tema=azul|calido` al `<html>` antes del
 * primer pintado (el shell trae TEMA_POR_DEFECTO). Mismo criterio que
 * `resolverTema` con la geo apagada: sólo la consulta cuenta; `auto` o
 * cualquier otro valor dejan el default. Si la geo vuelve, ver el comentario
 * de arriba.
 */
export function scriptTema(): string {
  return `(function(){try{var t=new URLSearchParams(location.search).get("tema");t=t&&t.trim().toLowerCase();var v=t==="azul"?"calido-azul":t==="calido"?"calido":null;if(v)document.documentElement.setAttribute("data-theme",v)}catch(e){}})();`;
}
