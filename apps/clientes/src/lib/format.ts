/** Formateo compartido. Módulo puro: lo usan cliente y servidor. */

/**
 * Precios: siempre con dos decimales ("$ 2.344.755,60", "$ 500,00"). Antes se
 * redondeaban al peso, y el preview del carrito —con su propio formateador—
 * mostraba "$ 2.344.755,6": el mismo carrito decía dos números distintos.
 */
const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtPrecio(n: number): string {
  return ARS.format(n);
}

/**
 * Pesos redondeados, sin decimales: sólo para los límites del filtro de
 * precio ("Precio: $ 500 – $ 50.000"). No son el precio de nada: son los
 * bordes de un rango, y ",00" en cada uno es ruido.
 */
const ARS_ENTERO = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function fmtPesosEnteros(n: number): string {
  return ARS_ENTERO.format(n);
}

export function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
