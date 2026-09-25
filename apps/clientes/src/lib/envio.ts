/**
 * Reglas de entrega del MVP (fase 2 de la propuesta).
 *
 * Módulo PURO a propósito: no importa la DB ni Alegra, así el checkout (client
 * component) y la validación del servidor comparten exactamente las mismas
 * reglas. Duplicarlas en el cliente y en el servidor es cómo se termina
 * mostrando "envío gratis" y rechazando el pedido dos pantallas después.
 */

export type EntregaTipo = "retiro" | "envio";
export type PagoMetodo =
  | "transferencia"
  | "efectivo"
  | "cuenta_corriente"
  | "mercadopago"
  // Sin medio de pago: un asesor lo coordina después de confirmado el pedido.
  // Es el único método válido mientras los pagos están apagados (pagos-flag.ts).
  | "a_coordinar";

/** Únicas ciudades con envío propio. El resto del país se coordina aparte. */
export const CIUDADES_ENVIO = ["Puerto Iguazú", "El Dorado"] as const;

/** Compara nombres de ciudad sin acentos, mayúsculas, espacios ni signos. */
function claveCiudad(ciudad: string): string {
  return ciudad
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * La ciudad tal como la escribe `CIUDADES_ENVIO` si está dentro de la zona de
 * envío propio, o null. Tolera acentos, mayúsculas, espacios y la grafía
 * pegada ("Eldorado" = "El Dorado"), que es como llega una dirección guardada
 * o una sugerencia del geocodificador.
 *
 * Es la ÚNICA definición de "zona de envío" para una dirección guardada: Mi
 * cuenta la usa para el aviso "se coordina por separado" y el checkout para
 * decidir qué ciudad manda al pedido. Cuando el envío se abra a todo el país,
 * se cambia acá (y en `evaluarEnvio`) y todo lo demás se acomoda solo.
 */
export function ciudadConEnvio(
  ciudad: string | null | undefined,
): (typeof CIUDADES_ENVIO)[number] | null {
  if (!ciudad) return null;
  const clave = claveCiudad(ciudad);
  if (!clave) return null;
  return CIUDADES_ENVIO.find((c) => claveCiudad(c) === clave) ?? null;
}

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
  mercadopago: "Tarjeta o Mercado Pago",
  a_coordinar: "A coordinar con un asesor",
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
    return { disponible: false, motivo: "Elija una ciudad." };
  }
  if (!CIUDADES_ENVIO.includes(ciudad as (typeof CIUDADES_ENVIO)[number])) {
    return {
      disponible: false,
      motivo: `Solo hacemos envío propio a ${CIUDADES_ENVIO.join(" y ")}. Para el resto del país, elija "Retiro en local / a coordinar" y lo gestionamos con usted.`,
    };
  }
  return { disponible: true };
}

/** Costo del envío. Hoy siempre 0: si califica es gratis, si no, no se ofrece. */
export function costoEnvio(tipo: EntregaTipo): number {
  return tipo === "envio" ? 0 : 0;
}

/**
 * Efectivo en el local solo tiene sentido si el cliente va a pasar por el local.
 * Mercado Pago no depende de la entrega: se cobra igual en los dos casos.
 *
 * El orden importa: es el que ve el cliente en el checkout, y `metodosPago[0]`
 * es el fallback cuando el método elegido deja de estar disponible.
 *
 * `pagosHabilitados` es OBLIGATORIO y llega de afuera: este módulo es puro y lo
 * importa el checkout (client component), así que no puede leer el env. El
 * server resuelve el flag (src/lib/pagos-flag.ts) y lo pasa; sin default para
 * que tsc obligue a cada caller a decidir. Apagado: el único método es
 * "a_coordinar", para cualquier entrega. Prendido: las listas de siempre, sin
 * "a_coordinar".
 */
export function pagosDisponibles(
  tipo: EntregaTipo,
  pagosHabilitados: boolean,
): PagoMetodo[] {
  if (!pagosHabilitados) return ["a_coordinar"];
  return tipo === "retiro"
    ? ["transferencia", "mercadopago", "efectivo"]
    : ["transferencia", "mercadopago"];
}
