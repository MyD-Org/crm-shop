/**
 * Mensajes `{ error }` de las API de comprobantes, en usted (CMP-1, CMP-2,
 * CMP-5). Viven acá y no en `route.ts` porque Next no admite exports extra en
 * una ruta; así los tests y el formulario usan el mismo texto.
 */
import { RECEIPTS_DAILY_LIMIT } from "./validacion";

export const COMPROBANTES_NO_DISPONIBLE =
  "El servicio de comprobantes no está disponible. Inténtelo de nuevo más tarde.";
export const FORMULARIO_INVALIDO = "Revise los datos del formulario.";
export const LIMITE_HORARIO = "Informó demasiados comprobantes en la última hora. Inténtelo de nuevo más tarde.";
export const LIMITE_DIARIO = `Llegó al límite de ${RECEIPTS_DAILY_LIMIT} comprobantes por día. Inténtelo de nuevo mañana.`;
export const INIT_CAIDO = "No pudimos preparar la subida del comprobante. Inténtelo de nuevo en unos minutos.";
export const CONFIRM_CAIDO = "No pudimos procesar el comprobante. Inténtelo de nuevo en unos minutos.";
export const HISTORIAL_CAIDO = "No pudimos obtener sus comprobantes. Inténtelo de nuevo en unos minutos.";
