/**
 * Disponibilidad por modalidad lista para MOSTRAR (ficha, carrito, checkout). SOLO servidor.
 *
 * Toma las sucursales y las reglas de venta de las cachés de mostrar (`sucursales-datos.ts`) y el
 * stock/reserva de una lectura sin caché por ids. Es informativa: lo que decide y escribe un pedido
 * es `crearPedido`, que relee todo fresco dentro de la transacción.
 */
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";
import type {
  DisponibilidadVista,
  LocalDisponibilidad,
} from "./disponibilidad-textos";
import { disponibilidadDe } from "./stock-sucursal";
import { reglasVentaCacheadas, sucursalesCacheadas } from "./sucursales-datos";
import { resolverZona } from "./sucursales";

/**
 * Contexto de la zona que corresponde a una provincia elegida (checkout, envío): la sucursal que la
 * atiende según las zonas del CRM. Sin provincia o sin zona resoluble, el contexto del visitante.
 * Sólo cambia `zona`; lo demás (activas, herencia) es del contexto base.
 */
export async function contextoParaProvincia(
  base: ContextoDisponibilidad,
  provincia: string | null | undefined,
): Promise<ContextoDisponibilidad> {
  if (!provincia) return base;
  try {
    const datos = await sucursalesCacheadas();
    const r = resolverZona(provincia, datos.zonas, datos.sucursales);
    return "error" in r ? base : { ...base, zona: r.sucursal };
  } catch {
    return base;
  }
}

export interface DisponibilidadParaMostrar {
  /** Por id de producto: envío y retiro por local. */
  productos: Record<string, DisponibilidadVista>;
  /** Locales que aceptan retiro, por `orden`, con el nombre para el texto. */
  locales: LocalDisponibilidad[];
}

/**
 * `disp` es el contexto del visitante (`dispDelVisitante()`); sin él (flag apagado) no hay nada
 * que mostrar. Si algo falla, `null`: la ficha y el carrito se ven sin las líneas de disponibilidad.
 */
export async function disponibilidadParaMostrar(
  ids: string[],
  disp: ContextoDisponibilidad | undefined,
  cantidades?: Record<string, number>,
): Promise<DisponibilidadParaMostrar | null> {
  if (!disp || ids.length === 0) return null;
  try {
    const [datos, reglas] = await Promise.all([
      sucursalesCacheadas(),
      reglasVentaCacheadas(),
    ]);
    const r = await disponibilidadDe(ids, disp.zona, "ambas", {
      sucursales: datos.sucursales,
      reglas,
      cantidades,
    });
    const locales = datos.sucursales
      .filter((s) => s.activa && s.aceptaRetiro)
      .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
      .map((s) => ({ slug: s.slug, nombre: s.nombre }));
    return { productos: r.productos, locales };
  } catch (err) {
    console.error(
      "[disponibilidad] no se pudo leer la disponibilidad por sucursal:",
      err,
    );
    return null;
  }
}
