/**
 * Vocabulario propio de pagos. Módulo PURO: sin DB, sin red, sin secretos.
 *
 * Lo importan tanto el servidor como el checkout (client component), así que no
 * puede arrastrar el cliente HTTP de ningún proveedor.
 *
 * La idea que ordena todo: **el resto del sistema no habla el idioma de
 * Mercado Pago**. Cada proveedor traduce sus códigos a estos tipos dentro de su
 * propio archivo. Cuando entre Mobbex o MODO, se agrega una tabla de traducción
 * y nada más — los mensajes al cliente se escriben una sola vez, acá.
 */

import type { PagoEstado } from "@/data/orders";

/** Medios que puede elegir el comprador dentro de un proveedor online. */
export type PagoMedio = "tarjeta" | "cuenta_mp";

/**
 * Por qué se cayó un pago, en términos nuestros.
 *
 * No son los códigos del proveedor: son las categorías que cambian **qué le
 * decimos al cliente que haga**. Dos códigos distintos que se resuelven igual
 * comparten motivo; un código que se resuelve distinto merece el suyo.
 */
export type MotivoRechazo =
  /** Se arregla acá mismo, reescribiendo la tarjeta. */
  | "datos_invalidos"
  /** Se arregla con otra tarjeta o pagando por transferencia. */
  | "fondos"
  | "limite"
  | "cuotas_no_disponibles"
  /** Se resuelve rehaciendo el intento, sin cambiar nada. */
  | "desafio_vencido"
  /** Requiere que el cliente hable con su banco. */
  | "banco_rechazo"
  | "tarjeta_inhabilitada"
  | "requiere_autorizacion"
  /** Situaciones donde reintentar YA es lo peor que puede hacer. */
  | "demasiados_intentos"
  /** Antifraude. Nunca se explica el motivo real. */
  | "riesgo"
  | "desconocido";

/**
 * Mensajes al comprador. Cada uno dice **qué pasó** y **qué hacer** — un
 * "error al procesar el pago" convierte en pérdida una venta que casi siempre
 * era recuperable: la mayoría de los rechazos se arreglan reintentando bien.
 *
 * `riesgo` no explica el motivo a propósito: detallar el antifraude es darle un
 * mapa a quien está probando tarjetas robadas.
 */
export const MENSAJE_RECHAZO: Record<MotivoRechazo, string> = {
  datos_invalidos:
    "Revisá el número, la fecha de vencimiento y el código de seguridad.",
  fondos:
    "La tarjeta no tiene fondos suficientes para este monto. Probá con otra o pagá por transferencia.",
  limite:
    "El monto supera el límite de tu tarjeta. Probá con otra, en cuotas, o por transferencia.",
  cuotas_no_disponibles:
    "Esa cantidad de cuotas no está disponible para tu tarjeta. Elegí otra opción de cuotas.",
  desafio_vencido:
    "Se venció el tiempo para validar el pago con tu banco. Volvé a intentar y completá la validación apenas te la pida.",
  banco_rechazo:
    "Tu banco rechazó la operación. Llamalos al número del dorso de la tarjeta y pedí que la habiliten para compras online.",
  tarjeta_inhabilitada:
    "Esta tarjeta está inhabilitada. Llamá a tu banco para activarla o usá otra.",
  requiere_autorizacion:
    "Tu banco necesita autorizar este pago. Llamalos al dorso de la tarjeta y volvé a intentar.",
  demasiados_intentos:
    "Demasiados intentos con esta tarjeta. Esperá unos minutos o usá otra.",
  riesgo:
    "No pudimos procesar el pago. Probá con otro medio o escribinos y lo resolvemos.",
  desconocido:
    "No pudimos procesar el pago. Probá de nuevo o elegí transferencia.",
};

/**
 * ¿Tiene sentido que el cliente reintente con la MISMA tarjeta?
 *
 * Lo usa el checkout para decidir si deja el formulario listo para reintentar o
 * si empuja a cambiar de medio. Reintentar igual cuando el banco pide una
 * llamada solo suma rechazos y baja la tasa de aprobación.
 */
export function convieneReintentar(motivo: MotivoRechazo): boolean {
  return (
    motivo === "datos_invalidos" ||
    motivo === "cuotas_no_disponibles" ||
    motivo === "desafio_vencido"
  );
}

/** Desafío 3D Secure pendiente: el banco quiere validar al titular. */
export interface Desafio3DS {
  externalResourceUrl: string;
  creq: string;
}

/**
 * Estado de un pago traducido a lo nuestro. Mapea 1 a 1 con las columnas
 * `pago_*` de `orders`.
 */
export interface EstadoPago {
  estado: PagoEstado;
  /** Id del pago en el proveedor. Lo que hace idempotente al webhook. */
  referencia: string;
  /** Código crudo del proveedor, sin traducir. Para poder diagnosticar. */
  detalle: string;
  /** Solo cuando `estado === "fallido"`. */
  motivo?: MotivoRechazo;
  /**
   * El proveedor informó un contracargo o una devolución.
   *
   * Lo calcula el proveedor, que es el único que ve su status crudo. Antes esto
   * se intentaba deducir afuera comparando contra `estado` y `detalle`, y no
   * podía funcionar: `estado` ya está traducido a nuestro vocabulario y
   * `detalle` es el status_detail, así que la comparación nunca daba true y un
   * contracargo no llegaba a desmarcar el pedido.
   */
  reversion?: boolean;
  /** Presente cuando el banco pide 3DS: hay que renderizar el desafío. */
  desafio?: Desafio3DS;
}

/** Lo que hace falta para crear un pago. El monto NUNCA sale del browser. */
export interface DatosPago {
  pedidoId: string;
  /** Total en pesos, leído del pedido ya persistido. */
  monto: number;
  descripcion: string;
  medio: PagoMedio;
  emailComprador?: string;
  /** Token de tarjeta que devolvió el brick. Ausente para `cuenta_mp`. */
  token?: string;
  cuotas?: number;
  metodoPagoId?: string;
  tipoDocumento?: string;
  numeroDocumento?: string;
}

/**
 * Contrato que cumple cada proveedor. Sumar Mobbex o MODO es implementar esto
 * en un archivo nuevo — no tocar el checkout ni la ruta de pedidos.
 */
export interface ProveedorPago {
  readonly id: string;
  crearPago(datos: DatosPago): Promise<EstadoPago>;
  consultarPago(referencia: string): Promise<EstadoPago>;
  /**
   * Valida la firma del webhook y devuelve la referencia a consultar. Nunca
   * devuelve el estado: el payload no es fuente de verdad, solo dice qué ID
   * mirar.
   */
  verificarWebhook(
    req: Request,
    cuerpo: string,
  ): Promise<{ valido: boolean; referencia?: string }>;
}
