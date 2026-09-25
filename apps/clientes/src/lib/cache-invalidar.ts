/**
 * Invalidación de las cachés de datos desde lo que el propio Shop escribe.
 *
 * Un pedido nuevo o cancelado cambia el stock DISPONIBLE (la reserva de
 * `shop.stock_reservado` se resta al leer), así que marca vencido el tag
 * `catalogo`. Con el perfil `max` (stale-while-revalidate): la próxima vista
 * sirve lo cacheado y lo renueva en segundo plano. El precio y el stock que
 * se cobran nunca salen de la caché (el carrito y el pedido cotizan en vivo),
 * así que un listado unos segundos atrasado no vende de más.
 *
 * Nunca tira: el pedido ya quedó guardado y es lo que importa. Si la
 * invalidación falla, el TTL de 15 minutos del perfil `catalogo` lo cubre.
 */
import { revalidateTag } from "next/cache";
import { TAG_CATALOGO } from "./cache-tags";

export function marcarStockCambiado(origen: string): void {
  try {
    revalidateTag(TAG_CATALOGO, "max");
  } catch (err) {
    console.warn(`[cache] no se pudo invalidar el catálogo tras ${origen}:`, err);
  }
}
