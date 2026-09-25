/**
 * Textos de exhibición de cuotas. TODOS en un solo lugar: están sujetos a la
 * revisión del contador (tarea 0.4 de cuotas-configurables), así que cambiar
 * un texto no tiene que obligar a recorrer componentes.
 *
 * Módulo puro: lo usan componentes de cliente y de servidor.
 */

/** Montos, siempre con dos decimales: "$20.000,00" o "$10.333,33". Sin espacio, igual que PrecioConImpuestos. */
export function fmtMonto(n: number): string {
  return `$${n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Porcentajes: "45,67%". */
export function fmtPct(n: number): string {
  return `${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const cuotasDe = (n: number) => (n === 1 ? "1 cuota" : `${n} cuotas`);

export const TEXTOS_CUOTAS = {
  verMediosDePago: "Ver medios de pago",
  tituloModal: "Medios de pago",
  descripcionModal: (precio: number) => `Opciones de pago para ${fmtMonto(precio)}`,
  unPago: "1 pago",
  precioContado: "Precio contado",
  total: "Total",
  sinInteres: "Sin interés",
  sinOpcionesMedio: "Para este precio sólo 1 pago.",
  /** Encabezado de cada bloque del modal: "Tarjetas de crédito (Mercado Pago)". */
  tituloProveedor: (nombre: string) => `Tarjetas de crédito (${nombre})`,

  cft: (pct: number) => `CFT ${fmtPct(pct)}`,
  tea: (pct: number) => `TEA ${fmtPct(pct)}`,

  /** "6 cuotas sin interés de $20.000" / "12 cuotas de $13.500". */
  linea: (cuotas: number, montoCuota: number, sinInteres: boolean) =>
    sinInteres
      ? `${cuotasDe(cuotas)} sin interés de ${fmtMonto(montoCuota)}`
      : `${cuotasDe(cuotas)} de ${fmtMonto(montoCuota)}`,

  /** Cuotas de una fila del modal: "6 cuotas de $20.000". */
  filaCuotas: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} de ${fmtMonto(montoCuota)}`,

  /** "Hasta 6 cuotas sin interés" / "Hasta 12 cuotas". */
  hasta: (cuotas: number, sinInteres: boolean) =>
    `Hasta ${cuotasDe(cuotas)}${sinInteres ? " sin interés" : ""}`,

  /** "Le faltan $30.000 para hasta 6 cuotas". */
  teFaltan: (faltante: number, cuotas: number) =>
    `Le faltan ${fmtMonto(faltante)} para hasta ${cuotasDe(cuotas)}`,

  progresoEscalon: "Progreso hacia el próximo plan de cuotas",
  checkoutTitulo: "Cuotas para este pedido",
} as const;
