/**
 * Medios de pago cargados en el CRM (`public.medios_pago_shop`), lógica PURA: la comparten el
 * checkout (client component) y la validación del servidor, así lo que se ofrece y lo que se
 * acepta no pueden divergir. Sin base ni flags.
 *
 * Con el flag `pedido-a-confirmar` el paso Pago ofrece estos medios en vez de las opciones fijas de
 * `envio.ts`, y `orders.pago_metodo` guarda el `slug`. No hay cobro en ese paso: `cobroOnline` se
 * trata como manual hasta que exista la integración.
 */
import { PAGO_LABEL, type EntregaTipo, type PagoMetodo } from "./envio";

export interface MedioPago {
  slug: string;
  nombre: string;
  /** Cómo se paga (datos de la cuenta, condiciones). Puede venir vacío. */
  instrucciones: string;
  activo: boolean;
  aplicaRetiro: boolean;
  aplicaEnvio: boolean;
  /** Reservado para una integración futura: hoy se trata como un medio manual. */
  cobroOnline: boolean;
  orden: number;
}

/**
 * Slugs que el admin no puede usar como medio del Shop: `mercadopago` dispara el cobro en línea
 * (que este flujo no hace) y `a_coordinar` es el valor de respaldo cuando ningún medio aplica.
 */
export const SLUGS_RESERVADOS: readonly string[] = ["mercadopago", "a_coordinar"];

/** Nota del paso Pago: en este flujo el pedido queda "a confirmar", sin cobro. */
export const NOTA_PAGO_A_CONFIRMAR =
  "El pago se coordina después de confirmar el pedido; no se cobra en este paso.";

/**
 * Medios que se ofrecen para la modalidad: activos, que aplican a ella y sin slugs reservados, en el
 * orden que fijó el operador (empate: por nombre, para que el resultado sea estable).
 */
export function mediosParaModalidad(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
): MedioPago[] {
  return medios
    .filter(
      (m) =>
        m.activo &&
        !SLUGS_RESERVADOS.includes(m.slug) &&
        (entrega === "retiro" ? m.aplicaRetiro : m.aplicaEnvio),
    )
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}

/** El medio elegido si sigue aplicando a la modalidad; si no, el primero de la lista (o null). */
export function medioElegido(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  slug: string,
): MedioPago | null {
  const aplicables = mediosParaModalidad(medios, entrega);
  return aplicables.find((m) => m.slug === slug) ?? aplicables[0] ?? null;
}

/**
 * ¿Es válido ese `pago_metodo` para el pedido? Con medios aplicables, sólo uno de ellos. Si NINGUNO
 * aplica a la modalidad (el operador no cargó ninguno para ella), el pedido sale "a_coordinar":
 * dejar el checkout sin salida sería peor que coordinar el pago con un asesor.
 */
export function pagoValidoConMedios(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  pagoMetodo: string,
): boolean {
  const aplicables = mediosParaModalidad(medios, entrega);
  if (aplicables.length === 0) return pagoMetodo === "a_coordinar";
  return aplicables.some((m) => m.slug === pagoMetodo);
}

/**
 * Nombre para mostrar de lo que guarda `orders.pago_metodo`: el del medio del CRM si el slug
 * coincide (aunque después se haya desactivado: el pedido conserva lo que eligió el cliente), si no
 * la etiqueta de los métodos fijos y, en último caso, el texto crudo.
 */
export function nombreDelPago(
  pagoMetodo: string,
  medios: readonly MedioPago[] | null | undefined,
): string {
  const medio = medios?.find((m) => m.slug === pagoMetodo);
  if (medio) return medio.nombre;
  return PAGO_LABEL[pagoMetodo as PagoMetodo] ?? pagoMetodo;
}

/** Las instrucciones del medio de ese slug, o null si no hay medio o no las tiene. */
export function instruccionesDelPago(
  pagoMetodo: string,
  medios: readonly MedioPago[] | null | undefined,
): string | null {
  const t = medios?.find((m) => m.slug === pagoMetodo)?.instrucciones.trim();
  return t ? t : null;
}
