/**
 * Reglas de entrega del MVP (fase 2 de la propuesta).
 *
 * Módulo PURO a propósito: no importa la DB ni Alegra, así el checkout (client
 * component) y la validación del servidor comparten exactamente las mismas
 * reglas. Duplicarlas en el cliente y en el servidor es cómo se termina
 * mostrando "envío gratis" y rechazando el pedido dos pantallas después.
 */

export type EntregaTipo = "retiro" | "envio";
export type PagoMetodo = "transferencia" | "efectivo" | "cuenta_corriente";

/** Únicas ciudades con envío propio. El resto del país se coordina aparte. */
export const CIUDADES_ENVIO = ["Puerto Iguazú", "El Dorado"] as const;

/** Piso de compra (sin IVA) para que el envío a domicilio esté disponible. */
export const MINIMO_ENVIO = 100_000;

export const ENTREGA_LABEL: Record<EntregaTipo, string> = {
  retiro: "Retiro en local / a coordinar",
  envio: "Envío a domicilio",
};

export const PAGO_LABEL: Record<PagoMetodo, string> = {
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo en el local",
  cuenta_corriente: "Cuenta corriente",
};

/**
 * ¿Se puede elegir envío a domicilio? Solo a Iguazú/El Dorado y por encima del
 * mínimo. Devuelve el motivo para poder explicárselo al cliente en vez de
 * mostrarle una opción deshabilitada sin razón.
 */
export function evaluarEnvio(
  subtotal: number,
  ciudad: string | null | undefined,
): { disponible: boolean; motivo?: string } {
  if (subtotal < MINIMO_ENVIO) {
    return {
      disponible: false,
      motivo: `El envío a domicilio está disponible a partir de $${MINIMO_ENVIO.toLocaleString("es-AR")} sin impuestos.`,
    };
  }
  if (!ciudad) {
    return { disponible: false, motivo: "Elegí una ciudad." };
  }
  if (!CIUDADES_ENVIO.includes(ciudad as (typeof CIUDADES_ENVIO)[number])) {
    return {
      disponible: false,
      motivo: `Solo hacemos envío propio a ${CIUDADES_ENVIO.join(" y ")}. Para el resto del país elegí "Retiro / a coordinar" y lo gestionamos con vos.`,
    };
  }
  return { disponible: true };
}

/** Costo del envío. Hoy siempre 0: si califica es gratis, si no, no se ofrece. */
export function costoEnvio(tipo: EntregaTipo): number {
  return tipo === "envio" ? 0 : 0;
}

/** Efectivo en el local solo tiene sentido si el cliente va a pasar por el local. */
export function pagosDisponibles(tipo: EntregaTipo): PagoMetodo[] {
  return tipo === "retiro"
    ? ["transferencia", "efectivo"]
    : ["transferencia"];
}
