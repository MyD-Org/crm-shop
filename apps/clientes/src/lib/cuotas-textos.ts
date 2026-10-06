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
import { fmtPrecio, fmtPrecioCorto } from "./format";

const cuotasDe = (n: number) => (n === 1 ? "1 cuota" : `${n} cuotas`);

export const TEXTOS_CUOTAS = {
  verMediosDePago: "Ver medios de pago",
  tituloModal: "Medios de pago",
  descripcionModal: (precio: number) => `Opciones de pago para ${fmtPrecio(precio)}`,
  /** Título del bloque único del modal (no nombra al procesador). */
  tituloTarjeta: "Tarjeta de crédito o débito",
  unPago: "1 pago",
  precioContado: "Precio contado",
  total: "Total",
  sinInteres: "Sin interés",
  /** "6 cuotas sin interés de $20.000". */
  linea: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)}`,

  /**
   * Cuotas de una fila del modal: "6 cuotas de $20.000". El monto va redondeado al centavo hacia
   * arriba; el banco decide dónde van los centavos y el total exacto está al lado.
   */
  filaCuotas: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} de ${fmtPrecio(montoCuota)}`,

  /** "Hasta 6 cuotas sin interés". */
  hasta: (cuotas: number) => `Hasta ${cuotasDe(cuotas)} sin interés`,

  // --- Checkout ---
  checkoutTitulo: "Cantidad de cuotas",
  checkoutAyuda: (medio: string) => `Se pagan con tarjeta de crédito en ${medio}, sin interés.`,
  /**
   * Barra y checkout, faltante: "Sume $790 más y pague en 6 cuotas sin interés." El monto va en
   * negrita: la vista parte el texto con `montoFaltante` (mismo formato, sin ,00).
   */
  faltaParaCuotas: (falta: number, cuotas: number) =>
    `Sume ${fmtPrecioCorto(falta)} más y pague en ${cuotasDe(cuotas)} sin interés.`,
  /** El fragmento del texto de `faltaParaCuotas` que va en negrita. */
  montoFaltante: (falta: number) => fmtPrecioCorto(falta),
  /** Estado lleno de la barra: "¡Listo! Su compra ya tiene 12 cuotas sin interés." */
  cuotasCompletas: (cuotas: number) => `¡Listo! Su compra ya tiene ${cuotasDe(cuotas)} sin interés.`,
  barraAria: "Progreso hacia más cuotas sin interés",
  /** Fila atenuada del modal: "6 cuotas sin interés en compras desde $90.000". */
  filaNoAlcanzada: (cuotas: number, minimo: number) =>
    `${cuotasDe(cuotas)} sin interés en compras desde ${fmtPrecio(minimo)}`,
  checkoutUnPago: (total: number) => `1 pago de ${fmtPrecio(total)}`,
  checkoutCuotas: (cuotas: number, montoCuota: number, total: number) =>
    `${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)} (total ${fmtPrecio(total)})`,
  /** Rechazos del servidor por la cantidad de cuotas. */
  cuotasNoCoinciden: "La cantidad de cuotas no coincide con la seleccionada. Vuelva a elegir su medio de pago.",
  cuotasNoDisponibles: "La cantidad de cuotas elegida ya no está disponible. Seleccione otra.",
} as const;
