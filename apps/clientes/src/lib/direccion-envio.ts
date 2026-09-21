/**
 * Dirección de envío a partir de la de facturación: el atajo "usar la misma
 * dirección" del formulario de direcciones. Módulo puro.
 */

interface DomicilioFacturacion {
  domicilioCalle?: string | null;
  domicilioCiudad?: string | null;
  domicilioCp?: string | null;
}

export interface DireccionPrellenada {
  calle: string;
  ciudad: string;
  cp: string;
}

/** Etiqueta con la que se guarda la dirección copiada, si no puso otra. */
export const ETIQUETA_FACTURACION = "Facturación";

/**
 * Los datos para prellenar el envío, o null si no hay domicilio de facturación
 * cargado (sin calle no hay nada útil que copiar). Ciudad y CP pueden venir
 * vacíos: el formulario los deja completar.
 */
export function direccionDesdeFacturacion(
  perfil: DomicilioFacturacion | null | undefined,
): DireccionPrellenada | null {
  const calle = perfil?.domicilioCalle?.trim();
  if (!calle) return null;
  return {
    calle,
    ciudad: perfil?.domicilioCiudad?.trim() ?? "",
    cp: perfil?.domicilioCp?.trim() ?? "",
  };
}

function normalizar(calle: string): string {
  return calle.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * ¿La dirección de facturación ya está usada como envío? Sirve para no volver
 * a ofrecer el atajo cuando ya se aplicó al formulario o ya hay una dirección
 * guardada con esa calle.
 */
export function yaUsaDireccion(
  facturacion: DireccionPrellenada | null,
  calles: string[],
): boolean {
  if (!facturacion) return false;
  const objetivo = normalizar(facturacion.calle);
  return calles.some((c) => normalizar(c) === objetivo);
}
