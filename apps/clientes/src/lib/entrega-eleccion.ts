/**
 * Consumo de la elección "Enviar a" en el carrito y la ficha. Módulo PURO.
 */
import { localesPorConveniencia, type LocalDisponibilidad } from "./disponibilidad-textos";
import type { EntregaTipo } from "./envio";
import type { DisponibilidadRetiro } from "./sucursales-disponibilidad";
import type { EleccionUbicacion } from "./ubicacion";

/**
 * Cómo cotiza el carrito según la elección. Retiro: sin costo de envío ni barra de envío gratis,
 * y SIN provincia (mandarla haría que `contextoParaProvincia` pise la sucursal del local elegido).
 * Envío a una provincia conocida: cotiza como envío a esa provincia. Sin elección o sin provincia:
 * el comportamiento de siempre (retiro por defecto; la ficha del carrito pide la ubicación).
 */
export function entregaDelCarrito(eleccion: EleccionUbicacion): {
  entregaTipo: EntregaTipo;
  provincia: string | null;
  /** ¿Hay una elección que permita hablar de envío (no hace falta pedir la localidad)? */
  ubicacionConocida: boolean;
} {
  if (eleccion.tipo === "envio" && eleccion.provincia) {
    return { entregaTipo: "envio", provincia: eleccion.provincia, ubicacionConocida: true };
  }
  return { entregaTipo: "retiro", provincia: null, ubicacionConocida: eleccion.tipo === "retiro" };
}

/**
 * Locales de la fila de retiro de la ficha: el elegido aparte (siga o no con stock: se le dice al
 * visitante que no está disponible en SU local) y los demás por conveniencia, sin ocultar ninguno.
 */
export function retiroDeFicha(
  locales: LocalDisponibilidad[],
  retiro: Record<string, DisponibilidadRetiro>,
  elegidoSlug: string | null | undefined,
): { elegido: LocalDisponibilidad | null; otros: LocalDisponibilidad[] } {
  const ordenados = localesPorConveniencia(locales, retiro);
  const elegido = elegidoSlug ? (ordenados.find((l) => l.slug === elegidoSlug) ?? null) : null;
  return { elegido, otros: ordenados.filter((l) => l !== elegido) };
}
