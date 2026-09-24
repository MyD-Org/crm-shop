/**
 * Mensajes `{ error }` de las API de cuenta corriente, en usted. Viven acá y no
 * en cada `route.ts` porque Next no admite exports extra en una ruta; así los
 * tests y la UI usan el mismo texto.
 */
export const ALEGRA_OCUPADO = "El sistema de facturación está ocupado. Inténtelo de nuevo en unos minutos.";
export const FACTURAS_CAIDAS = "No pudimos obtener sus facturas. Inténtelo de nuevo en unos minutos.";

export const DOCUMENTO_INVALIDO = "Indique el documento.";
export const DOCUMENTO_NO_ENCONTRADO = "No encontramos el documento.";
export const DOCUMENTO_CAIDO = "No pudimos obtener el documento. Inténtelo de nuevo en unos minutos.";

/** Motivo técnico para el log: sólo el código HTTP de Alegra, nunca el cuerpo. */
export function motivoAlegra(err: unknown): string {
  const estado = err instanceof Error ? /Alegra (\d{3})/.exec(err.message)?.[1] : undefined;
  return estado ?? "sin respuesta";
}
