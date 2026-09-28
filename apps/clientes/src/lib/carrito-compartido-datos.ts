/**
 * Productos de un carrito compartido, resueltos para quien ABRE el link: con
 * SU lista de precios, igual que `/api/carrito` (el carrito después muestra lo
 * mismo). SOLO servidor: usa la DB.
 *
 * A diferencia de `enriquecer()` (carrito-db.ts), sólo cuenta los productos
 * activos y publicados: un carrito compartido no debería meter en el carrito
 * de otro algo que la tienda ya no vende.
 */

import { identidadActual, idPriceListCliente } from "@/lib/auth";
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
  const idPriceList = cliente ? await idPriceListCliente(cliente.codigocliente) : undefined;
  const productos = await getProductosPorIds(
    lineas.map((l) => l.id),
    { idPriceList, soloActivos: true, soloVisibles },
  );
  return lineas.map(({ id, qty }) => {
    const p = productos.get(id);
    if (!p) {
      return {
        item: { id, qty, name: "Producto no disponible", brand: "", price: 0, faltante: true },
        precioExhibido: 0,
      };
    }
    return {
      item: { id, qty, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0]?.url },
      precioExhibido: p.precioFinal ?? p.price,
    };
  });
}
