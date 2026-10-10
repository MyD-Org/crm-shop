/**
 * Textos de exhibición de las cuotas sin interés. TODOS en un solo lugar: están sujetos a la
 * revisión del contador/abogado (gate de la rebanada D), así que cambiar un texto no tiene que
 * obligar a recorrer componentes. Registro: usted / neutro, sin coloquialismos.
 *
 * Las cuotas de la tienda son SIEMPRE sin interés (el costo financiero lo absorbe la tienda y ya está
 * en el precio de la lista). Las con interés son del procesador (Mercado Pago), sobre el precio en 1
 * pago: sólo se eligen dentro del formulario de pago, con el CFT/TEA que él informa (`formulario*`).
 *
 * Módulo puro: lo usan componentes de cliente y de servidor.
 */
import { fmtPrecio, fmtPrecioCorto } from "./format";

const cuotasDe = (n: number) => (n === 1 ? "1 cuota" : `${n} cuotas`);
/** "a", "a y b", "a, b y c". */
const enumerar = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

export const TEXTOS_CUOTAS = {
  verMediosDePago: "Ver medios de pago",
  tituloModal: "Medios de pago",
  descripcionModal: (precio: number) => `Opciones de pago para ${fmtPrecio(precio)}`,
  /** Título del bloque único del modal (no nombra al procesador). */
  tituloTarjeta: "Tarjeta de crédito o débito",
  /** Títulos de los dos bloques cuando la tarjeta de débito tiene un precio distinto. */
  tituloDebito: "Tarjeta de débito",
  tituloCredito: "Tarjeta de crédito",
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
  /**
   * Barra y checkout, faltante: "Sume $790 más y pague en 6 cuotas sin interés." El monto va en
   * negrita: la vista parte el texto con `montoFaltante` (mismo formato, sin ,00).
   */
  faltaParaCuotas: (falta: number, cuotas: number) =>
    `Sume ${fmtPrecioCorto(falta)} más y pague en ${cuotasDe(cuotas)} sin interés.`,
  /** El fragmento del texto de `faltaParaCuotas` que va en negrita. */
  montoFaltante: (falta: number) => fmtPrecioCorto(falta),
  /** Estado lleno de la barra: "Su compra ya tiene 12 cuotas sin interés." */
  cuotasCompletas: (cuotas: number) => `Su compra ya tiene ${cuotasDe(cuotas)} sin interés.`,
  /** Nivel ya alcanzado con su cuota: "8 cuotas sin interés de $20.000" (el fragmento en negrita). */
  cuotasConMonto: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)}`,
  /** Carrito y checkout, con un nivel más alto por delante: "Ya tiene 8 cuotas sin interés de $20.000." */
  yaTiene: (cuotas: number, montoCuota: number) => `Ya tiene ${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)}.`,
  /** Carrito y checkout, en el nivel más alto. */
  compraYaTiene: (cuotas: number, montoCuota: number) =>
    `Su compra ya tiene ${cuotasDe(cuotas)} sin interés de ${fmtPrecio(montoCuota)}.`,
  /** Ficha: leyenda chica debajo de la línea verde cuando el nivel se alcanza gracias al carrito. */
  /** Modal de la ficha: nota de la fila de cuotas que se alcanza gracias al carrito. */
  /** Fila del modal alcanzada con el carrito: "En compras desde $30.000". */
  enComprasDesde: (minimo: number) => `En compras desde ${fmtPrecioCorto(minimo)}`,
  /**
   * Ficha, debajo de la línea de cuotas del producto: el nivel mayor que se alcanza con una compra
   * más grande. "Hasta 8 cuotas sin interés en compras desde $30.000".
   */
  hastaCuotasDesde: (cuotas: number, minimo: number) =>
    `Hasta ${cuotasDe(cuotas)} sin interés en compras desde ${fmtPrecioCorto(minimo)}`,
  /** Ficha del producto, con el carrito: "6 cuotas" (el fragmento que va en negrita). */
  cantidadCuotas: (cuotas: number) => cuotasDe(cuotas),
  /**
   * Ficha: la compra (carrito + este producto) no llega todavía; el monto va en negrita
   * (`montoFaltante`). "Le faltan $790 para pagar en 8 cuotas sin interés."
   */
  fichaFaltaParaCuotas: (falta: number, cuotas: number) =>
    `Le faltan ${fmtPrecioCorto(falta)} para pagar en ${cuotasDe(cuotas)} sin interés.`,
  barraAria: "Progreso hacia más cuotas sin interés",
  /** Fila atenuada del modal: "6 cuotas sin interés en compras desde $90.000" (sin ",00"). */
  filaNoAlcanzada: (cuotas: number, minimo: number) =>
    `${cuotasDe(cuotas)} sin interés en compras desde ${fmtPrecioCorto(minimo)}`,
  // --- Formulario de pago (cuotas según la tarjeta cargada) ---
  formularioTitulo: "Cuotas",
  /** "Cuotas con su Visa". */
  formularioTituloMarca: (marca: string) => `Cuotas con su ${marca}`,
  /** Fila del desplegable: "1 pago de $50.000" / "6 cuotas de $11.000". */
  formularioOpcion: (cuotas: number, montoCuota: number) =>
    cuotas === 1 ? `1 pago de ${fmtPrecio(montoCuota)}` : `${cuotasDe(cuotas)} de ${fmtPrecio(montoCuota)}`,
  /** Sólo con una cuota con interés: quién la financia (el procesador del medio en uso). */
  formularioFinancia: (procesador: string) => `Las cuotas con interés las financia ${procesador}.`,
  /** "6 y 12 cuotas sin interés: sólo con Visa y Mastercard." (sólo con la tarjeta ya cargada). */
  formularioRestringidas: (cuotas: number[], marcas: string[]) =>
    `${enumerar(cuotas.map(String))} cuotas sin interés: sólo con ${enumerar(marcas)}.`,
  /**
   * La cantidad elegida no está con la tarjeta cargada (otra marca): "6 cuotas sin interés no están
   * disponibles con su Naranja. Quedó seleccionado 1 pago; puede elegir otra cantidad."
   */
  formularioNoDisponible: (cuotas: number, sinInteres: boolean, marca: string | null) =>
    `${cuotas} cuotas${sinInteres ? " sin interés" : ""} no están disponibles con su ${marca ?? "tarjeta"}. Quedó seleccionado 1 pago; puede elegir otra cantidad.`,
  pagar: (monto: number) => `Pagar ${fmtPrecio(monto)}`,
  /** "Pagar en 6 cuotas de $11.000"; en el celular, "Pagar 6 × $11.000". */
  pagarEnCuotas: (cuotas: number, montoCuota: number) => `Pagar en ${cuotas} cuotas de ${fmtPrecio(montoCuota)}`,
  pagarEnCuotasCorto: (cuotas: number, montoCuota: number) => `Pagar ${cuotas} × ${fmtPrecio(montoCuota)}`,
  /** Resumen lateral con cuotas con interés. */
  precioUnPago: "Precio en 1 pago",
  interesFinanciacion: "Interés de la financiación",
  /** Resumen lateral con cuotas con interés: "6 cuotas de $11.000". */
  cuotasDe: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} de ${fmtPrecio(montoCuota)}`,

  /** Rechazos del servidor por la cantidad de cuotas. */
  cuotasNoCoinciden: "La cantidad de cuotas no coincide con la seleccionada. Vuelva a elegir su medio de pago.",
  cuotasNoDisponibles: "La cantidad de cuotas elegida ya no está disponible. Seleccione otra.",
} as const;
