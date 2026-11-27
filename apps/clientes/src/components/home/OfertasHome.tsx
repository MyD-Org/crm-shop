import type { Product } from "@/data/products";
import { OfertasHomeCuenta, TEXTOS_OFERTAS_HOME } from "@/components/home/OfertasHomeCuenta";
import type { CampaniaActiva } from "@/lib/campanias/vigentes";
import { paginaOfertasPublica } from "@/lib/catalogo-publico";
import type { ContextoDisponibilidad } from "@/lib/disponibilidad-contexto";
import type { MediosPrecio } from "@/lib/medios-precio";

export { TEXTOS_OFERTAS_HOME };

/** Cuántas ofertas muestra el bloque (las de mayor descuento, con stock). */
export const CANTIDAD_OFERTAS_HOME = 8;

/**
 * Las ofertas del bloque: «Solo ofertas» con stock, por mayor descuento, de la caché del catálogo
 * (las campañas activas son parte de la clave). Si la base falla, ninguna: el bloque no se dibuja.
 */
export async function ofertasParaHome(args: {
  soloVisibles: boolean;
  agrupar: boolean;
  disp: ContextoDisponibilidad | undefined;
  mediosPrecio: MediosPrecio | undefined;
  campanias: CampaniaActiva[];
}): Promise<Product[]> {
  if (args.campanias.length === 0) return [];
  try {
    const { productos } = await paginaOfertasPublica({
      soloVisibles: args.soloVisibles,
      ...(args.agrupar ? { agrupar: true } : {}),
      disp: args.disp,
      destacado: args.mediosPrecio?.destacado,
      cuotas: args.mediosPrecio?.cuotas,
      campanias: args.campanias,
    });
    return productos.slice(0, CANTIDAD_OFERTAS_HOME);
  } catch (err) {
    console.error("[OfertasHome] no se pudieron cargar las ofertas:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Bloque «Precios especiales por tiempo limitado» (diseño «Ofertas más llamativas», punto 2): banda
 * en el color de la marca, cinta en el resaltado, las ofertas de mayor descuento con la misma card
 * del catálogo (borde y pestaña de campaña) y «Ver todas las ofertas». Sin productos, nada.
 */
export function OfertasHomeVista({ productos }: { productos: Product[] }) {
  if (productos.length === 0) return null;
  return <OfertasHomeCuenta productos={productos} />;
}
