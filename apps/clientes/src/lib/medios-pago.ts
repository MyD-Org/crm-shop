/**
 * Medios de pago cargados en el CRM (`public.medios_pago_shop`), lógica PURA: la comparten el
 * checkout (client component) y la validación del servidor, así lo que se ofrece y lo que se
 * acepta no pueden divergir. Sin base ni flags.
 *
 * El paso Pago ofrece estos medios y `orders.pago_metodo` guarda el `slug`. Todos quedan "a
 * confirmar" sin cobro, salvo `mercadopago` (fila fija con `cobroOnline`), que dispara el cobro en
 * línea. Esa fila sólo se ofrece si hay credenciales: el servidor lo resuelve (`mpDisponible`).
 */
import type { CondicionCuotas } from "./cuotas-sin-interes";
import { PAGO_LABEL, type EntregaTipo, type PagoMetodo } from "./envio";

export interface MedioPago {
  slug: string;
  nombre: string;
  /** Cómo se paga (datos de la cuenta, condiciones). Puede venir vacío. */
  instrucciones: string;
  activo: boolean;
  aplicaRetiro: boolean;
  aplicaEnvio: boolean;
  /** Sólo la fila fija `mercadopago`: dispara el cobro en línea. */
  cobroOnline: boolean;
  orden: number;
  /**
   * Lista de precios de Alegra enlazada al medio (id, no secreto); `null` = lista por defecto. La
   * resuelve el servidor desde el slug: el cliente nunca manda una lista.
   */
  idListaPrecios: string | null;
  /**
   * Cuotas sin interés del medio (rebanada D): una condición por cantidad N >= 2, con la lista online
   * cuyo precio se divide en N. Sólo se usa en el medio de cobro en línea. Ausente = sin cuotas.
   */
  condicionesCuotas?: CondicionCuotas[];
  /** El catálogo muestra "$X con <Medio>" bajo el precio (a lo sumo un medio por tenant). */
  destacarEnCatalogo: boolean;
  /** La ficha del producto muestra una línea "$X con <Medio>" (cualquier cantidad de medios). */
  mostrarEnFicha: boolean;
}

/** Slug de la fila fija que dispara el cobro en línea con Mercado Pago. */
export const SLUG_MERCADOPAGO = "mercadopago";

/** Slug que el admin no puede usar: es el valor de respaldo cuando ningún medio aplica. */
export const SLUGS_RESERVADOS: readonly string[] = ["a_coordinar"];

/**
 * Qué procesador de cobro atiende a cada medio de pago con cobro en línea (id del registro de
 * `pagos/index.ts`). El procesador se elige POR MEDIO, no es global: pueden convivir varios activos
 * (cada medio apunta al suyo). Sumar otro procesador = su adaptador + una línea acá. La lógica de
 * cuotas (condiciones, cuota, congelado, validación, reconciliación) no depende de esta tabla.
 */
export const PROCESADOR_DE_MEDIO: Readonly<Record<string, string>> = {
  [SLUG_MERCADOPAGO]: "mercadopago",
};

/** Id del procesador que cobra este medio; null = el medio no se cobra en línea. */
export function procesadorDeMedio(slug: string): string | null {
  return Object.hasOwn(PROCESADOR_DE_MEDIO, slug) ? PROCESADOR_DE_MEDIO[slug] : null;
}

/** ¿Este `pago_metodo` se cobra en línea? */
export function esPagoEnLinea(slug: string): boolean {
  return procesadorDeMedio(slug) !== null;
}

export interface OpcionesMedios {
  /**
   * ¿Hay credenciales de Mercado Pago en el Shop? Por defecto sí (la lógica es pura: el servidor
   * decide). Con `false` la fila `mercadopago` no se ofrece ni se acepta aunque esté activa.
   */
  mpDisponible?: boolean;
}

/** Nota del paso Pago: con los medios manuales el pedido queda "a confirmar", sin cobro. */
export const NOTA_PAGO_A_CONFIRMAR =
  "El pago se coordina después de confirmar el pedido; no se cobra en este paso.";

/** Pie bajo "Confirmar pedido" según el medio elegido (la transferencia lo arma el checkout). */
export const PIE_MERCADOPAGO = "Al confirmar el pedido, pasará a pagar con Mercado Pago.";
export const PIE_A_COORDINAR = "No se le cobrará nada ahora. Un asesor coordinará el pago con usted.";
export const PIE_GENERICO = "No se le cobra nada ahora. Coordinamos el pago al confirmar el pedido.";

/** Pie para el medio elegido; `null` = no hay medio aplicable (el pedido sale "a_coordinar"). */
export function pieDelMedio(medio: MedioPago | null): string {
  if (!medio) return PIE_A_COORDINAR;
  return esPagoEnLinea(medio.slug) ? PIE_MERCADOPAGO : PIE_GENERICO;
}

/**
 * Medios que se ofrecen para la modalidad: activos, que aplican a ella y sin slugs reservados (y sin
 * Mercado Pago si faltan credenciales), en el orden que fijó el operador (empate: por nombre, para
 * que el resultado sea estable).
 */
export function mediosParaModalidad(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  opts: OpcionesMedios = {},
): MedioPago[] {
  const mpDisponible = opts.mpDisponible ?? true;
  return medios
    .filter(
      (m) =>
        m.activo &&
        !SLUGS_RESERVADOS.includes(m.slug) &&
        (mpDisponible || m.slug !== SLUG_MERCADOPAGO) &&
        (entrega === "retiro" ? m.aplicaRetiro : m.aplicaEnvio),
    )
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}

/** El medio elegido si sigue aplicando a la modalidad; si no, el primero de la lista (o null). */
export function medioElegido(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  slug: string,
  opts?: OpcionesMedios,
): MedioPago | null {
  const aplicables = mediosParaModalidad(medios, entrega, opts);
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
  opts?: OpcionesMedios,
): boolean {
  const aplicables = mediosParaModalidad(medios, entrega, opts);
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
