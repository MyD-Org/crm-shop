/**
 * Productos de un carrito compartido, resueltos para quien ABRE el link: con
 * SU lista privada si la tiene, igual que `/api/carrito` (el carrito después muestra lo
 * mismo). SOLO servidor: usa la DB.
 *
 * A diferencia de `enriquecer()` (carrito-db.ts), sólo cuenta los productos
 * activos y publicados: un carrito compartido no debería meter en el carrito
 * de otro algo que la tienda ya no vende.
 */

import { identidadActual } from "@/lib/auth";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { preciosPrivados } from "@/lib/precios-privados-repo";
import { precioFinal } from "@/lib/precio-final";
import { getProductosPorIds } from "@/lib/catalog";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import type { CartItem, LineaCarrito } from "@/lib/carrito-cliente";

export interface ProductoCompartido {
  /** Listo para `addItems` / `replaceItems`. `price` es el NETO, como en el carrito. */
  item: CartItem;
  /** Unitario para mostrar: con IVA si se conoce, como en la ficha. */
  precioExhibido: number;
}

export async function productosCompartidos(
  lineas: readonly LineaCarrito[],
): Promise<ProductoCompartido[]> {
  if (lineas.length === 0) return [];
  const [{ cliente }, soloVisibles] = await Promise.all([identidadActual(), catalogoSoloVisibles()]);
  const idListaPrivada = cliente ? await listaPrivadaDelComprador() : null;
  const ids = lineas.map((l) => l.id);
  const [productos, privados] = await Promise.all([
    getProductosPorIds(ids, { soloActivos: true, soloVisibles }),
    idListaPrivada ? preciosPrivados(idListaPrivada, ids) : Promise.resolve(null),
  ]);
  return lineas.map(({ id, qty }) => {
    const p = productos.get(id);
    if (!p) {
      return {
        item: { id, qty, name: "Producto no disponible", brand: "", price: 0, faltante: true },
        precioExhibido: 0,
      };
    }
    // Con lista privada: su neto (0 = sin precio en su lista, "Consulte") y su final con IVA.
    const neto = privados ? (privados.get(id) ?? 0) : p.price;
    const exhibido = privados ? (precioFinal(neto, p.ivaPorcentaje) ?? neto) : (p.precioFinal ?? p.price);
    return {
      item: { id, qty, name: p.name, brand: p.brand, price: neto, image: p.images?.[0]?.url },
      precioExhibido: exhibido,
    };
  });
}
