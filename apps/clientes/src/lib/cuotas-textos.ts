/**
 * Textos de exhibición de cuotas. TODOS en un solo lugar: están sujetos a la
 * revisión del contador (tarea 0.4 de cuotas-configurables), así que cambiar
 * una leyenda no tiene que obligar a recorrer componentes.
 *
 * Módulo puro: lo usan componentes de cliente y de servidor.
 */

/** Montos: "$20.000" o "$10.333,33". Sin espacio, igual que PrecioConImpuestos. */
export function fmtMonto(n: number): string {
  const conCentavos = Math.round(n * 100) % 100 !== 0;
  return `$${n.toLocaleString("es-AR", {
    minimumFractionDigits: conCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Porcentajes: "45,67%". */
export function fmtPct(n: number): string {
  return `${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const cuotasDe = (n: number) => (n === 1 ? "1 cuota" : `${n} cuotas`);

export const TEXTOS_CUOTAS = {
  /** Leyenda obligatoria en toda superficie previa al Brick que muestre cuotas. */
  leyenda: "Valores de referencia. El valor final de las cuotas depende de tu banco.",
  /** Versión corta para la card del catálogo. */
  leyendaCorta: "Valor de referencia",

  verMediosDePago: "Ver medios de pago",
  tituloModal: "Medios de pago",
  descripcionModal: (precio: number) => `Opciones de pago para ${fmtMonto(precio)}`,
  unPago: "1 pago",
  precioContado: "Precio contado",
  total: "Total",
  sinInteres: "Sin interés",
  sinOpcionesMedio: "Para este precio sólo 1 pago.",

  cft: (pct: number) => `CFT ${fmtPct(pct)}`,
  tea: (pct: number) => `TEA ${fmtPct(pct)}`,

  /** "6 cuotas sin interés de $20.000" / "12 cuotas de $13.500". */
  linea: (cuotas: number, montoCuota: number, sinInteres: boolean) =>
    `${cuotasDe(cuotas)}${sinInteres ? " sin interés" : ""} de ${fmtMonto(montoCuota)}`,

  /** Cuotas de una fila del modal: "6 cuotas de $20.000". */
  filaCuotas: (cuotas: number, montoCuota: number) => `${cuotasDe(cuotas)} de ${fmtMonto(montoCuota)}`,

  /** "Hasta 6 cuotas sin interés" / "Hasta 12 cuotas". */
  hasta: (cuotas: number, sinInteres: boolean) =>
    `Hasta ${cuotasDe(cuotas)}${sinInteres ? " sin interés" : ""}`,

  /** "Te faltan $30.000 para 6 cuotas sin interés" / "… para 12 cuotas". */
  teFaltan: (faltante: number, cuotas: number, sinInteres: boolean) =>
    `Te faltan ${fmtMonto(faltante)} para ${cuotasDe(cuotas)}${sinInteres ? " sin interés" : ""}`,

  progresoEscalon: "Progreso hacia el próximo plan de cuotas",
  checkoutTitulo: "Cuotas para este pedido",
} as const;
