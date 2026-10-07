/**
 * Medios de pago cargados en el CRM (`public.medios_pago_shop`), lógica PURA: la comparten el
 * checkout (client component) y la validación del servidor, así lo que se ofrece y lo que se
 * acepta no pueden divergir. Sin base ni flags.
 *
 * El paso Pago ofrece estos medios y `orders.pago_metodo` guarda el `slug`. Todos quedan "a
 * confirmar" sin cobro, salvo `mercadopago` (fila fija con `cobroOnline`), que dispara el cobro en
 * línea. Ese medio sólo se ofrece si su procesador tiene credenciales: el servidor lo resuelve
 * (`procesadorDisponible`).
 */
import type { CondicionCuotas } from "./cuotas-sin-interes";
import type { ChipMedio } from "./medios-pago-chips";
import { PAGO_LABEL, type EntregaTipo, type PagoMetodo } from "./envio";

export interface MedioPago {
  slug: string;
  nombre: string;
  /** Cómo se paga (datos de la cuenta, condiciones). Puede venir vacío. */
  instrucciones: string;
  activo: boolean;
  aplicaRetiro: boolean;
  aplicaEnvio: boolean;
  /** Sólo las filas fijas de cobro en línea (`mercadopago`, `payway`): disparan el cobro. */
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
  /**
   * Quién puede pagar con el medio (migración 0069 del CRM). Ausente o `publico` = cualquiera;
   * `cuenta_corriente` = SOLO clientes con cuenta corriente: el público no lo ve en el checkout, ni
   * en "con medio" ni en la ficha, y el servidor lo rechaza. A lo sumo uno por tenant. Se identifica
   * siempre por este campo, nunca por el nombre ni el slug.
   */
  audiencia?: AudienciaMedio;
  /**
   * Etiquetas que el admin carga para este medio (migración 0071 del CRM): se muestran resaltadas
   * sobre la opción del medio en el checkout, en este orden (hasta 3). Ausente = sin etiquetas.
   */
  chips?: ChipMedio[];
}

export type AudienciaMedio = "publico" | "cuenta_corriente";

/** ¿El medio es el de las cuentas corrientes? */
export function esMedioCuentaCorriente(m: Pick<MedioPago, "audiencia">): boolean {
  return m.audiencia === "cuenta_corriente";
}

/** ¿El comprador tiene cuenta corriente? Sólo `tipoCuenta === "corriente"` (lo resuelve el servidor). */
export function esCompradorCuentaCorriente(
  cliente: { tipoCuenta?: string | null } | null | undefined,
): boolean {
  return cliente?.tipoCuenta === "corriente";
}

/**
 * Lo que puede viajar al navegador (props del checkout): el comprador con cuenta corriente recibe
 * SÓLO el medio de su audiencia; el resto (público, contado) nunca recibe ese medio, ni su nombre ni
 * sus instrucciones. Es la contraparte de `mediosParaModalidad` para los datos, no sólo la lista.
 */
export function mediosVisiblesPara(medios: readonly MedioPago[], esCuentaCorriente: boolean): MedioPago[] {
  return medios.filter((m) => esMedioCuentaCorriente(m) === esCuentaCorriente);
}

/** Slug de la fila fija que dispara el cobro en línea con Mercado Pago. */
export const SLUG_MERCADOPAGO = "mercadopago";

/** Slug de la fila fija de Payway (cobro en línea; el adaptador llega en otra rebanada). */
export const SLUG_PAYWAY = "payway";

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
  // Fila fija sembrada por la 0067 del CRM. Hasta que exista el adaptador (`pagos/payway.ts`) y las
  // credenciales, `procesadorConfigurado("payway")` es false y el medio no se ofrece.
  [SLUG_PAYWAY]: "payway",
};

/** Id del procesador que cobra este medio; null = el medio no se cobra en línea. */
export function procesadorDeMedio(slug: string): string | null {
  return Object.hasOwn(PROCESADOR_DE_MEDIO, slug) ? PROCESADOR_DE_MEDIO[slug] : null;
}

/** Slugs de los medios que se cobran en línea (los que tienen procesador). */
export function slugsPagoEnLinea(): string[] {
  return Object.keys(PROCESADOR_DE_MEDIO);
}

/** ¿Este `pago_metodo` se cobra en línea? */
export function esPagoEnLinea(slug: string): boolean {
  return procesadorDeMedio(slug) !== null;
}

export interface OpcionesMedios {
  /**
   * ¿El procesador de cobro (id del registro de `pagos/index.ts`) tiene credenciales en el Shop? La
   * lógica es pura: el servidor pasa `procesadorConfigurado`. Un medio con cobro en línea cuyo
   * procesador no está disponible no se ofrece ni se acepta aunque esté activo. Por defecto, todos.
   */
  procesadorDisponible?: (procesadorId: string) => boolean;
  /**
   * Atajo heredado: `false` oculta el procesador del medio `mercadopago`. Lo pisa
   * `procesadorDisponible` si viene. Los llamadores nuevos usan `procesadorDisponible`.
   */
  mpDisponible?: boolean;
  /**
   * El comprador tiene cuenta corriente: sólo se ofrece (y acepta) el medio de audiencia
   * `cuenta_corriente`. Sin esto (público) ese medio jamás aparece. Lo resuelve el servidor, nunca
   * el navegador (rebanada D del change `listas-cuenta-corriente`).
   */
  esCuentaCorriente?: boolean;
}

/** ¿Se puede ofrecer este medio con las credenciales que hay? Los medios manuales siempre. */
function medioOfrecible(slug: string, opts: OpcionesMedios): boolean {
  const procesador = procesadorDeMedio(slug);
  if (procesador === null) return true;
  if (opts.procesadorDisponible) return opts.procesadorDisponible(procesador);
  return slug === SLUG_MERCADOPAGO ? (opts.mpDisponible ?? true) : true;
}

/** Pie bajo "Confirmar pedido" según el medio elegido (la transferencia lo arma el checkout). */
export const PIE_MERCADOPAGO = "Al confirmar el pedido, pasará a pagar con Mercado Pago.";
/** Pie del medio con cobro en línea, por procesador; sin entrada propia, el genérico. */
const PIE_EN_LINEA: Readonly<Record<string, string>> = {
  mercadopago: PIE_MERCADOPAGO,
};
export const PIE_EN_LINEA_GENERICO = "Al confirmar el pedido, pasará a pagar en línea.";
export const PIE_A_COORDINAR = "No se le cobrará nada ahora. Un asesor coordinará el pago con usted.";
export const PIE_GENERICO = "No se le cobra nada ahora. Coordinamos el pago al confirmar el pedido.";

/** Qué medio usa el comprador con cuenta corriente (el nombre sale del medio cargado en el CRM). */
export function textoPagaConMedio(nombre: string): string {
  return `Pagará con ${nombre}.`;
}

/** Pie para el medio elegido; `null` = no hay medio aplicable (el pedido sale "a_coordinar"). */
export function pieDelMedio(medio: MedioPago | null): string {
  if (!medio) return PIE_A_COORDINAR;
  if (esMedioCuentaCorriente(medio)) return `${textoPagaConMedio(medio.nombre)} No se le cobra nada ahora.`;
  const procesador = procesadorDeMedio(medio.slug);
  if (procesador === null) return PIE_GENERICO;
  return PIE_EN_LINEA[procesador] ?? PIE_EN_LINEA_GENERICO;
}

/**
 * Medios que se ofrecen para la modalidad: activos, que aplican a ella y sin slugs reservados (y sin
 * el medio cuyo procesador no tiene credenciales), en el orden que fijó el operador (empate: por nombre, para
 * que el resultado sea estable).
 */
export function mediosParaModalidad(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  opts: OpcionesMedios = {},
): MedioPago[] {
  return medios
    .filter(
      (m) =>
        m.activo &&
        !SLUGS_RESERVADOS.includes(m.slug) &&
        medioOfrecible(m.slug, opts) &&
        esMedioCuentaCorriente(m) === (opts.esCuentaCorriente === true) &&
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
