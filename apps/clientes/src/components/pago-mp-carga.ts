/**
 * Lógica pura de la carga del formulario de Mercado Pago (sin React ni DOM, así
 * se prueba en el entorno node de los tests unitarios).
 */

/**
 * Plazo para que el Brick avise `onReady` desde que se monta. Pasado ese tiempo
 * se asume que no cargó (red caída, script bloqueado) y se ofrece "Reintentar".
 *
 * Se cuenta DESDE QUE SE MONTA EL BRICK, no desde que se muestra el componente:
 * antes de montarlo puede esperar la preferencia de dinero en cuenta, que tiene su
 * propio corte de 10 s. Así el peor caso es 10 s + 15 s y nunca se corta una carga
 * que todavía no empezó.
 */
export const PLAZO_CARGA_MS = 15_000;

/**
 * El SDK distingue errores `critical` (el formulario no puede usarse) de
 * `non_critical` (p. ej. datos de tarjeta inválidos, que el Brick ya muestra en
 * sus propios campos). Un error sin tipo se trata como crítico: ante la duda se
 * ofrece reintentar en vez de dejar un formulario roto sin aviso.
 */
export function esErrorCritico(error: unknown): boolean {
  const tipo = (error as { type?: unknown } | null | undefined)?.type;
  return tipo !== "non_critical";
}

type ConFase = { fase: string };

/** El Brick avisó que está listo: también recupera de un error de carga. Nunca pisa un rechazo ni un pago en curso. */
export function alEstarListo<E extends ConFase>(e: E): E | { fase: "formulario" } {
  return e.fase === "cargando" || e.fase === "error_formulario" ? { fase: "formulario" } : e;
}

/** Sólo un error crítico lleva a `error_formulario`; los no críticos no cambian el estado. */
export function alFallarBrick<E extends ConFase>(e: E, error: unknown): E | { fase: "error_formulario" } {
  if (!esErrorCritico(error)) return e;
  return e.fase === "cargando" || e.fase === "formulario" || e.fase === "error_formulario"
    ? { fase: "error_formulario" }
    : e;
}

/** Venció el plazo sin `onReady`: sólo importa si todavía se está cargando. */
export function alVencerPlazo<E extends ConFase>(e: E): E | { fase: "error_formulario" } {
  return e.fase === "cargando" ? { fase: "error_formulario" } : e;
}

/** Arma el plazo de carga; devuelve la función que lo cancela. */
export function iniciarPlazoCarga(alVencer: () => void, ms: number = PLAZO_CARGA_MS): () => void {
  const timer = setTimeout(alVencer, ms);
  return () => clearTimeout(timer);
}
