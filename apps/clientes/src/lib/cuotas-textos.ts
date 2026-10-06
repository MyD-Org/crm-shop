/**
 * Textos de exhibición de las cuotas sin interés. TODOS en un solo lugar: están sujetos a la
 * revisión del contador/abogado (gate de la rebanada D), así que cambiar un texto no tiene que
 * obligar a recorrer componentes. Registro: usted / neutro, sin coloquialismos.
 *
 * Las cuotas son SIEMPRE sin interés (el costo financiero lo absorbe la tienda y ya está en el
 * precio de la lista): no hay recargo, ni CFT/TEA, ni "total con recargo".
 *
 * Módulo puro: lo usan componentes de cliente y de servidor.
 */
import { fmtPrecio } from "./format";

const cuotasDe = (n: number) => (n === 1 ? "1 cuota" : `${n} cuotas`);

export const TEXTOS_CUOTAS = {
  verMediosDePago: "Ver medios de pago",
  tituloModal: "Medios de pago",
  descripcionModal: (precio: number) => `Opciones de pago para ${fmtPrecio(precio)}`,
  unPago: "1 pago",
  precioContado: "Precio contado",
  total: "Total",
  sinInteres: "Sin interés",
  /** Encabezado del bloque del modal: "Tarjetas de crédito (Mercado Pago)". */
  tituloMedio: (nombre: string) => `Tarjetas de crédito (${nombre})`,

  /** "6 cuotas sin interés de $20.000". */
  linea: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)}`,

  /**
   * Cuotas de una fila del modal: "6 cuotas de $20.000". Si el total no divide exacto, la primera
   * absorbe el resto de centavos y se dice: "3 cuotas de $33,33 (la primera, $33,34)".
   */
  filaCuotas: (cuotas: number, montoCuota: number, primeraCuota: number = montoCuota) =>
    primeraCuota === montoCuota
      ? `${cuotasDe(cuotas)} de ${fmtPrecio(montoCuota)}`
      : `${cuotasDe(cuotas)} de ${fmtPrecio(montoCuota)} (la primera, ${fmtPrecio(primeraCuota)})`,

  /** "Hasta 6 cuotas sin interés". */
  hasta: (cuotas: number) => `Hasta ${cuotasDe(cuotas)} sin interés`,

  // --- Checkout ---
  checkoutTitulo: "Cantidad de cuotas",
  checkoutAyuda: (medio: string) => `Se pagan con tarjeta de crédito en ${medio}, sin interés.`,
  /** "Le faltan $790 para pagar en 6 cuotas sin interés." */
  faltaParaCuotas: (falta: number, cuotas: number) =>
    `Le faltan ${fmtPrecio(falta)} para pagar en ${cuotasDe(cuotas)} sin interés.`,
  checkoutUnPago: (total: number) => `1 pago de ${fmtPrecio(total)}`,
  checkoutCuotas: (cuotas: number, montoCuota: number, total: number) =>
    `${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)} (total ${fmtPrecio(total)})`,
  /** Rechazos del servidor por la cantidad de cuotas. */
  cuotasNoCoinciden: "La cantidad de cuotas no coincide con la seleccionada. Vuelva a elegir su medio de pago.",
  cuotasNoDisponibles: "La cantidad de cuotas elegida ya no está disponible. Seleccione otra.",
} as const;
