/**
 * Productos de una lista de favoritos compartida, en el orden del link. SOLO
 * servidor: usa la base.
 *
 * Sólo cuenta lo que la tienda vende hoy (activos y, según el flag, publicados):
 * lo demás se omite y se cuenta en `noDisponibles` sin dar ningún dato. El
 * precio es el público; quien tiene una lista privada lo ve cambiar en el
 * navegador (`usePreciosCuenta`), igual que en Mi cuenta.
 */
import type { Product } from "@/data/products";
import { getProductosPorIds } from "./catalog";
import { catalogoSoloVisibles } from "./catalogo-flag";
import { flagsPublicos } from "./flags-publicos";

export async function productosFavoritosCompartidos(
  ids: readonly string[],
): Promise<{ productos: Product[]; noDisponibles: number }> {
  if (ids.length === 0) return { productos: [], noDisponibles: 0 };
  const [soloVisibles, { mediosPrecio }] = await Promise.all([catalogoSoloVisibles(), flagsPublicos()]);
  const porId = await getProductosPorIds([...ids], {
    soloActivos: true,
    soloVisibles,
    // "$X con <Medio>" sólo del destacado (las cards no muestran los de la ficha).
    mediosPrecio: {
      destacado: mediosPrecio.destacado,
      ficha: [],
      ...(mediosPrecio.cuotas ? { cuotas: mediosPrecio.cuotas } : {}),
    },
  });
  const productos = ids.flatMap((id) => {
    const p = porId.get(id);
    return p && p.price > 0 ? [p] : [];
  });
  return { productos, noDisponibles: ids.length - productos.length };
}
